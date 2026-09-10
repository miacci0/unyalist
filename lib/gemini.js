// Gemini Flash系モデルに1回のプロンプトで「仕事依頼かどうかの判定」と「情報抽出」を
// 同時に行わせる(指示書セクション5)。モデルIDはGEMINI_MODELで上書き可能にしておく
// (Gemini側のモデル世代更新に追従しやすくするため)。
const DEFAULT_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `あなたはアニメーター宛に届いたメールを判別するアシスタントです。
このメールが「アニメーター個人への仕事依頼(作画・作監・原画・動画・撮影・OP/ED制作などの制作依頼)」かどうかを判定し、
仕事依頼である場合は内容を要約し、いくつかの項目を抽出してください。

以下は仕事依頼に含めないでください: 広告・ニュースレター・メルマガ、雑談・挨拶のみのメール、請求書・領収書、
イベント告知、求人紹介以外の一般的な営業メール。

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

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    is_job_inquiry: { type: "boolean" },
    confidence_score: { type: "number" },
    summary: { type: "string" },
    project_name: { type: ["string", "null"] },
    expected_deadline: { type: ["string", "null"] },
    expected_rate: { type: ["string", "null"] },
  },
  required: ["is_job_inquiry", "confidence_score", "summary"],
};

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
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
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
