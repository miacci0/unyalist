// Gemini Flash系モデルに1回のプロンプトで「仕事依頼かどうかの判定」と「情報抽出」を
// 同時に行わせる(指示書セクション5)。モデルIDはGEMINI_MODELで上書き可能にしておく
// (Gemini側のモデル世代更新に追従しやすくするため)。
// gemini-2.5-flashは新規ユーザー向けに提供終了となったため、2026年9月時点でGoogleが案内する
// gemini-3.6-flashに変更した。将来また提供終了になった場合はGEMINI_MODEL環境変数で
// コード変更なしに切り替えられる。
const DEFAULT_MODEL = "gemini-3.6-flash";

const SYSTEM_PROMPT = `あなたはアニメーター宛に届いたメールを判別するアシスタントです。
このメールが「アニメーター個人への仕事依頼・仕事の打診(作画・作監・原画・動画・撮影・OP/ED制作などの
制作依頼、またはそれに関する相談)」かどうかを判定し、仕事依頼である場合は内容を要約し、いくつかの
項目を抽出してください。

業界の慣習として、依頼メールは最初から具体的な工程名(作画・原画など)を明記せず、
「お仕事のご相談です」「ご依頼したい件がございます」のように柔らかく切り出されることが多い。
「依頼」「ご相談」「お願いしたい」といった語がキャリア・制作に関する文脈で使われている場合は、
具体的な作業内容が本文にまだ書かれていなくても仕事依頼として扱うこと。

以下は仕事依頼に含めないでください: 広告・ニュースレター・メルマガ、雑談・挨拶のみのメール、請求書・領収書、
イベント告知、求人紹介以外の一般的な営業メール。

判定に迷う場合(仕事関連の相談の可能性があるが確信が持てない場合)は、is_job_inquiryをtrueにしつつ
confidence_scoreを0.5前後の中間的な値にしてよい。ユーザー側で一覧から一件ずつ「違う」ボタンで
簡単に除外できる仕組みがあるため、迷ったら拾う側(true)に倒すこと。逆に、広告・メルマガ等と
明らかに判断できる場合はfalseにしてよい。

出力は次のJSON形式のみとし、それ以外の文字列(説明文やコードブロックのマーカーなど)は一切含めないでください。
{
  "is_job_inquiry": true または false,
  "confidence_score": 0から1の数値(仕事依頼らしさ),
  "summary": "内容の要約(1〜2文の日本語)",
  "project_name": "作品名・案件名の抽出結果、判別不能ならnull",
  "expected_deadline": "希望納期の自由記述の抽出結果、判別不能ならnull",
  "expected_rate": "単価・報酬情報の抽出結果、判別不能ならnull"
}
抽出できない項目は無理に埋めず null にしてください。`;

// Gemini APIのresponseSchemaはOpenAPI 3.0のサブセットで、typeは単一の文字列でなければならない
// (JSON Schemaの `type: ["string", "null"]` のような配列指定はサポートされておらず、
// 渡すとgenerateContent呼び出し自体がエラーになる)。nullを許容したい項目は
// `nullable: true` を別途付ける、というOpenAPI流の書き方にする必要がある。
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    is_job_inquiry: { type: "boolean" },
    confidence_score: { type: "number" },
    summary: { type: "string" },
    project_name: { type: "string", nullable: true },
    expected_deadline: { type: "string", nullable: true },
    expected_rate: { type: "string", nullable: true },
  },
  required: ["is_job_inquiry", "confidence_score", "summary"],
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 429(レート制限/割り当て超過)や5xx(Gemini側の一時的な障害)は、メール内容とは無関係な
// 一時的な失敗なので数回だけ待ってリトライする。それでも失敗する場合は呼び出し元
// (lib/gmailSync.js)がこのメッセージの保存自体をスキップし、次回実行で再挑戦できるようにする
// (「一時的に混み合っていただけ」を「仕事依頼ではない」と誤判定して保存してしまわないため)。
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [2000, 5000];

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // コードブロック(```json ... ```)で返ってきた場合の保険的なフォールバック。
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// 分類・抽出に失敗した場合はnullを返す(呼び出し側は非依頼相当としてスキップし、ログに残す)。
export async function classifyInquiry({ subject, senderName, senderEmail, bodyText }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // 本文が長すぎるとトークン消費・精度双方に悪影響なので、先頭部分だけ渡す。
  const trimmedBody = (bodyText || "").slice(0, 6000);

  const userContent = `件名: ${subject || "(件名なし)"}
送信者: ${senderName || ""} <${senderEmail || ""}>
本文:
${trimmedBody}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  });

  let res;
  let lastErrText = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: requestBody });
    if (res.ok) break;
    lastErrText = await res.text().catch(() => "");
    if (!isRetryableStatus(res.status) || attempt === MAX_RETRIES) {
      const err = new Error(`Gemini API error ${res.status}: ${lastErrText.slice(0, 300)}`);
      err.status = res.status;
      err.retryable = isRetryableStatus(res.status);
      throw err;
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed.is_job_inquiry !== "boolean") return null;

  return {
    isJobInquiry: parsed.is_job_inquiry,
    confidenceScore: typeof parsed.confidence_score === "number" ? parsed.confidence_score : 0,
    summary: parsed.summary || "",
    projectName: parsed.project_name ?? null,
    expectedDeadline: parsed.expected_deadline ?? null,
    expectedRate: parsed.expected_rate ?? null,
  };
}
