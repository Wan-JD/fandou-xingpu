export type JoinSeason = "spring" | "autumn";

export type ZodiacKey =
  | "capricorn" | "aquarius" | "pisces" | "aries" | "taurus" | "gemini"
  | "cancer" | "leo" | "virgo" | "libra" | "scorpio" | "sagittarius";

export type ZodiacMeta = { key: ZodiacKey; name: string; symbol: string; dateRange: string };

export const ZODIAC_META: Readonly<Record<ZodiacKey, ZodiacMeta>> = Object.freeze({
  capricorn: { key: "capricorn", name: "摩羯座", symbol: "♑", dateRange: "12.22-01.19" },
  aquarius: { key: "aquarius", name: "水瓶座", symbol: "♒", dateRange: "01.20-02.18" },
  pisces: { key: "pisces", name: "双鱼座", symbol: "♓", dateRange: "02.19-03.20" },
  aries: { key: "aries", name: "白羊座", symbol: "♈", dateRange: "03.21-04.19" },
  taurus: { key: "taurus", name: "金牛座", symbol: "♉", dateRange: "04.20-05.20" },
  gemini: { key: "gemini", name: "双子座", symbol: "♊", dateRange: "05.21-06.21" },
  cancer: { key: "cancer", name: "巨蟹座", symbol: "♋", dateRange: "06.22-07.22" },
  leo: { key: "leo", name: "狮子座", symbol: "♌", dateRange: "07.23-08.22" },
  virgo: { key: "virgo", name: "处女座", symbol: "♍", dateRange: "08.23-09.22" },
  libra: { key: "libra", name: "天秤座", symbol: "♎", dateRange: "09.23-10.23" },
  scorpio: { key: "scorpio", name: "天蝎座", symbol: "♏", dateRange: "10.24-11.22" },
  sagittarius: { key: "sagittarius", name: "射手座", symbol: "♐", dateRange: "11.23-12.21" },
});

export function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function zodiacForBirthday(birthday: string | null | undefined): ZodiacMeta | null {
  if (!birthday || !isValidDateOnly(birthday)) return null;
  const monthDay = Number(`${birthday.slice(5, 7)}${birthday.slice(8, 10)}`);
  const key: ZodiacKey = monthDay >= 1222 || monthDay <= 119 ? "capricorn"
    : monthDay <= 218 ? "aquarius"
      : monthDay <= 320 ? "pisces"
        : monthDay <= 419 ? "aries"
          : monthDay <= 520 ? "taurus"
            : monthDay <= 621 ? "gemini"
              : monthDay <= 722 ? "cancer"
                : monthDay <= 822 ? "leo"
                  : monthDay <= 922 ? "virgo"
                    : monthDay <= 1023 ? "libra"
                      : monthDay <= 1122 ? "scorpio"
                        : "sagittarius";
  return ZODIAC_META[key];
}

export function joinedAtFromSeason(year: number, season: JoinSeason): string {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new RangeError("Invalid join year");
  return `${year}-${season === "spring" ? "03" : "09"}-01`;
}

export function joinSeasonFromDate(value: string): { joinedYear: number; joinedSeason: JoinSeason; joinedAt: string } {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);
  if (!match) throw new RangeError("Invalid joined date");
  const joinedYear = Number(match[1]);
  const month = Number(match[2]);
  if (joinedYear < 1900 || joinedYear > 2200 || month < 1 || month > 12 || (value.length === 10 && !isValidDateOnly(value))) {
    throw new RangeError("Invalid joined date");
  }
  const joinedSeason: JoinSeason = month < 9 ? "spring" : "autumn";
  return { joinedYear, joinedSeason, joinedAt: joinedAtFromSeason(joinedYear, joinedSeason) };
}

export function formatJoinedSeason(value: { joinedYear: number; joinedSeason: JoinSeason } | string): string {
  const joined = typeof value === "string" ? joinSeasonFromDate(value) : value;
  return `${joined.joinedYear}年${joined.joinedSeason === "spring" ? "春季" : "秋季"}`;
}

function shanghaiParts(at: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "numeric",
  }).formatToParts(at);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

export function joinSeasonAt(at: Date = new Date()): { joinedYear: number; joinedSeason: JoinSeason; joinedAt: string } {
  const { year, month } = shanghaiParts(at);
  const joinedSeason: JoinSeason = month < 9 ? "spring" : "autumn";
  return { joinedYear: year, joinedSeason, joinedAt: joinedAtFromSeason(year, joinedSeason) };
}

export function academicYearAt(at: Date = new Date()): number {
  const { year, month } = shanghaiParts(at);
  return month >= 9 ? year : year - 1;
}

export function gradeForCohort(cohortYear: number | null | undefined, at: Date = new Date()): number | null {
  if (!Number.isInteger(cohortYear)) return null;
  const grade = academicYearAt(at) - Number(cohortYear) + 1;
  return grade >= 1 && grade <= 4 ? grade : null;
}

export function isDestinationStatisticEligible(
  person: { status: "active" | "archived"; cohortYear: number | null },
  at: Date = new Date(),
): boolean {
  return person.status === "archived" || gradeForCohort(person.cohortYear, at) === 4;
}
