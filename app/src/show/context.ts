const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function formatShowClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `周${WEEKDAYS[d.getDay()]} ${hh}:${mm}`;
}

/** Short Chinese sky line for the hosts. Unknown codes stay unnamed. */
export function describeWeather(code: number, temperatureC: number): string {
  const temp = `${Math.round(temperatureC)}°C`;
  let sky = "天气平常";
  if (code === 0) sky = "晴";
  else if (code >= 1 && code <= 3) sky = "多云";
  else if (code === 45 || code === 48) sky = "有雾";
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) sky = "雨";
  else if (code >= 71 && code <= 77) sky = "雪";
  else if (code >= 95 && code <= 99) sky = "雷雨";
  return `${sky}，${temp}`;
}
