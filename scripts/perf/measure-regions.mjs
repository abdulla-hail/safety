// زمن الذهاب والإياب (اتصال TCP) من هذا الجهاز إلى مناطق AWS التي تتوفر فيها Supabase، لتقدير أثر نقل القاعدة.
// لا يرسل أي بيانات؛ يفتح اتصال TCP على المنفذ 443 ويغلقه. الاستخدام: node scripts/perf/measure-regions.mjs
import net from "node:net";

const REGIONS = {
  "ap-northeast-2 (سيول — الحالية)": "ec2.ap-northeast-2.amazonaws.com",
  "ap-south-1 (مومباي)": "ec2.ap-south-1.amazonaws.com",
  "eu-central-1 (فرانكفورت)": "ec2.eu-central-1.amazonaws.com",
  "eu-central-2 (زيورخ)": "ec2.eu-central-2.amazonaws.com",
  "eu-west-3 (باريس)": "ec2.eu-west-3.amazonaws.com",
  "eu-west-2 (لندن)": "ec2.eu-west-2.amazonaws.com",
  "ap-southeast-1 (سنغافورة)": "ec2.ap-southeast-1.amazonaws.com",
  "us-east-1 (فرجينيا)": "ec2.us-east-1.amazonaws.com",
};

const connect = (host) => new Promise((resolve) => {
  const t = performance.now();
  const s = net.connect({ host, port: 443, timeout: 5000 }, () => { s.destroy(); resolve(performance.now() - t); });
  s.on("error", () => resolve(NaN));
  s.on("timeout", () => { s.destroy(); resolve(NaN); });
});

for (const [name, host] of Object.entries(REGIONS)) {
  await connect(host); // DNS
  const out = [];
  for (let i = 0; i < 5; i++) out.push(await connect(host));
  const s = out.filter(Number.isFinite).sort((a, b) => a - b);
  console.log(`${name.padEnd(34)} RTT min ${Math.round(s[0])}ms · median ${Math.round(s[Math.floor(s.length / 2)])}ms`);
}
