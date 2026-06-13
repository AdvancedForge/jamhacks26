export function hashColor(str: string) {
  if (!str) return "hsl(0,0%,40%)";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return `hsl(${Math.abs(h) % 360}, 58%, 55%)`;
}

export function genRoomCode() {
  return "HB-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
