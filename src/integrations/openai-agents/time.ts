const ISO_TIMESTAMP_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/;

export const nowUnixNano = (): string => {
  return (BigInt(Date.now()) * BigInt(1_000_000)).toString();
};

export const isoToUnixNano = (
  timestamp: string | null | undefined
): string | undefined => {
  if (!timestamp) {
    return undefined;
  }

  const match = ISO_TIMESTAMP_RE.exec(timestamp);
  if (!match) {
    const millis = Date.parse(timestamp);
    if (Number.isNaN(millis)) {
      return undefined;
    }
    return (BigInt(millis) * BigInt(1_000_000)).toString();
  }

  const [, base, fraction = "", timezone = "Z"] = match;
  const millis = Date.parse(`${base}${timezone}`);
  if (Number.isNaN(millis)) {
    return undefined;
  }

  const fractionalNanos = BigInt(
    (fraction + "000000000").slice(0, 9)
  );
  return (BigInt(millis) * BigInt(1_000_000) + fractionalNanos).toString();
};

export const minUnixNano = (...values: Array<string | undefined>): string => {
  const filtered = values.filter((value): value is string => value !== undefined);
  if (filtered.length === 0) {
    return nowUnixNano();
  }

  return filtered.reduce((min, current) =>
    BigInt(current) < BigInt(min) ? current : min
  );
};

export const maxUnixNano = (...values: Array<string | undefined>): string => {
  const filtered = values.filter((value): value is string => value !== undefined);
  if (filtered.length === 0) {
    return nowUnixNano();
  }

  return filtered.reduce((max, current) =>
    BigInt(current) > BigInt(max) ? current : max
  );
};
