/**
 * 슬랙 알림 — Vercel 서버리스 함수.
 *
 * 두 가지 방식으로 불립니다.
 *   · GET  /api/notify?mode=daily   ← vercel.json 의 크론 (평일 아침 9시 KST)
 *   · POST /api/notify              ← 정각에 온도를 바꿔야 할 때 브라우저가 호출
 *
 * 브라우저에서 슬랙 웹훅을 직접 부르면 CORS 에 막히기도 하고
 * 웹훅 주소가 노출되기도 해서, 반드시 이 함수를 거칩니다.
 *
 * SLACK_WEBHOOK_URL 을 안 넣으면 이 기능만 조용히 꺼집니다. 나머지는 그대로 돌아가요.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const SITE = process.env.PUBLIC_SITE_URL || "";

/** PostgREST 를 그냥 fetch 로 부릅니다. 이 함수에는 SDK 가 필요 없어요. */
async function q(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function post(text, blocks) {
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blocks ? { text, blocks } : { text }),
  });
  if (!res.ok) throw new Error(`슬랙 응답 ${res.status}`);
}

const f1 = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1));

export default async function handler(req, res) {
  if (!WEBHOOK) {
    return res.status(200).json({ ok: true, skipped: "SLACK_WEBHOOK_URL 이 없어서 건너뜀" });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: "SUPABASE_URL 또는 SERVICE_ROLE_KEY 가 없습니다" });
  }

  const mode = req.query?.mode === "daily" ? "daily" : "hourly";

  try {
    const [cfgRows, cpRows] = await Promise.all([
      q("config?id=eq.1&select=applied,room_size,season"),
      q("checkpoints?select=hour_at,setpoint,applied,n,changed,diff_avg,pace_avg,lec_n&order=hour_at.desc&limit=12"),
    ]);

    const cfg = cfgRows[0] || {};
    const latest = cpRows[0];
    if (!latest) return res.status(200).json({ ok: true, skipped: "아직 기록이 없음" });

    const link = SITE ? `\n<${SITE}|상태판 열기>` : "";

    if (mode === "hourly") {
      // 바꿀 필요가 없으면 조용히 넘어갑니다. 안 그러면 알림 피로가 옵니다.
      if (!latest.changed) {
        return res.status(200).json({ ok: true, skipped: "바꿀 필요 없음" });
      }
      const when = new Date(latest.hour_at).toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit",
      });
      await post(
        `🌡️ ${when} 정각 — 에어컨 ${f1(latest.applied)}°C → ${f1(latest.setpoint)}°C`,
        [
          { type: "header", text: { type: "plain_text", text: `🌡️ 온도 바꿀 시간이에요`, emoji: true } },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*${f1(latest.applied)}°C* → *${f1(latest.setpoint)}°C*\n` +
                `${when} 정각 기준 · ${latest.n}명의 표를 20% 절사평균으로 모은 값입니다.${link}`,
            },
          },
        ]
      );
      return res.status(200).json({ ok: true, sent: "hourly" });
    }

    // ── 아침 요약 ──
    const today = cpRows.filter((c) => {
      const d = new Date(c.hour_at);
      return Date.now() - d.getTime() < 20 * 3600e3;
    });
    const changes = today.filter((c) => c.changed).length;
    const lec = today.find((c) => c.lec_n > 0);

    const lines = [
      `오늘 권장 설정온도는 *${f1(latest.setpoint)}°C* 입니다.`,
      `현재 에어컨 설정 ${f1(cfg.applied)}°C · 참여 ${latest.n}/${cfg.room_size ?? 36}명`,
    ];
    if (changes) lines.push(`어제는 정각 확인에서 ${changes}번 바꿨어요.`);
    if (lec) {
      const say = (v, lo, hi) => (Math.abs(v) < 0.4 ? "딱 좋음" : v > 0 ? hi : lo);
      lines.push(
        `직전 강의 피드백 — 난이도 ${say(Number(lec.diff_avg), "쉬움", "어려움")}, ` +
        `속도 ${say(Number(lec.pace_avg), "느림", "빠름")} (${lec.lec_n}명)`
      );
    }
    lines.push("오늘도 각자 원하는 온도 한 번씩 찍어주세요 🙌");

    await post(`🌡️ 오늘 권장 ${f1(latest.setpoint)}°C`, [
      { type: "header", text: { type: "plain_text", text: "🌡️ 오늘의 강의실 온도", emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") + link } },
    ]);
    return res.status(200).json({ ok: true, sent: "daily" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
