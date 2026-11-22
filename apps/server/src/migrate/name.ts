/** An applied file was edited, a pending file failed, or a file is misnamed. Names the file. */
export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

const FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;
const NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const MIN_NAME_LENGTH = 3;

const EXPECTED = "<YYYYMMDDHHMMSS UTC>_<snake_case_name>.sql";

/**
 * The one place the migration naming rule lives (the runner and `migration:new` both use it).
 * `<YYYYMMDDHHMMSS>_<name>.sql`: a real UTC datetime, then a snake_case name that starts with a
 * letter, is at least 3 characters, and has no double or trailing underscores.
 */
export function parseMigrationName(file: string): { timestamp: Date; name: string } {
  const fail = (why: string): never => {
    throw new MigrationError(`migration ${file} is misnamed (${why}); expected ${EXPECTED}`);
  };
  const match = FILE_PATTERN.exec(file);
  const digits = match?.[1];
  const name = match?.[2];
  if (digits === undefined || name === undefined) return fail("no 14-digit timestamp prefix");

  const [y, mo, d, h, mi, s] = [
    digits.slice(0, 4),
    digits.slice(4, 6),
    digits.slice(6, 8),
    digits.slice(8, 10),
    digits.slice(10, 12),
    digits.slice(12, 14),
  ].map(Number) as [number, number, number, number, number, number];
  const timestamp = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC rolls invalid fields over (Feb 30 -> Mar 2), so a round-trip mismatch means invalid.
  const roundTrip = timestamp.toISOString().replace(/\D/g, "").slice(0, 14);
  if (roundTrip !== digits) return fail("timestamp is not a real UTC datetime");

  if (name.length < MIN_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    return fail("name must be snake_case, start with a letter and be at least 3 characters");
  }
  return { timestamp, name };
}
