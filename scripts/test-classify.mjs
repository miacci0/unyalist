// ローカルでlib/gemini.jsのプロンプト・responseSchemaの動作確認をするためのCLI。
// 件名・本文を対話的に貼り付けると、実際にGemini APIを呼び出して生のレスポンスを表示する。
// 実メールの受信やcron実行を介さずに素早く試せるので、プロンプトやスキーマを直した際は
// まずここで確認してから本番に反映するとよい(responseSchemaの不備のような、内容に関わらず
// 全件が失敗するタイプの不具合はここで即座に気づける)。
//
// package.jsonに"type":"module"を付けていないため(next.config.js等がCommonJS前提のため)、
// lib/gemini.js(ESM構文)をこのスクリプトから直接importできない。そのため、判定ロジック自体は
// lib/gemini.jsから意図的に複製している。プロンプト/スキーマを変更した場合は両方を
// 同じ内容に保つこと。
//
// 使い方: node scripts/test-classify.mjs
//   件名を1行入力→Enter、続けて本文を入力→最後にEOF(Ctrl+D、WindowsはCtrl+Z→Enter)

import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";

function loadEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

// --- 以下、lib/gemini.jsと同内容(理由は冒頭コメント参照) ---
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
// --- ここまで ---

async function classify({ subject, senderName, senderEmail, bodyText }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません(.env.localを確認してください)");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const userContent = `件名: ${subject || "(件名なし)"}
送信者: ${senderName || ""} <${senderEmail || ""}>
本文:
${(bodyText || "").slice(0, 6000)}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
    }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${rawText.slice(0, 500)}`);
  }
  return JSON.parse(rawText);
}

async function readMultiline(promptText) {
  console.log(promptText);
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join("\n");
}

async function main() {
  loadEnvLocal();

  const rlSubject = createInterface({ input: process.stdin, output: process.stdout });
  const subject = await new Promise(resolve => rlSubject.question("件名: ", answer => { rlSubject.close(); resolve(answer); }));

  const bodyText = await readMultiline("本文を貼り付けてください(入力し終えたらCtrl+D、WindowsはCtrl+Z→Enter):");

  console.log("\n--- Gemini呼び出し中 ---\n");
  const data = await classify({ subject, senderName: "", senderEmail: "", bodyText });

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log("=== 生レスポンス(候補テキスト) ===");
  console.log(text ?? JSON.stringify(data, null, 2));

  if (text) {
    console.log("\n=== JSONパース結果 ===");
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch (err) {
      console.log(`パースに失敗しました: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error("失敗しました:", err.message || err);
  process.exit(1);
});
