/**
 * TeamSpeak uint64 ids as decimal strings, in canonical form only: TS reads
 * "00" or "007" as 0 and 7, so a check on the string ("is it channel 0?")
 * would be fooled by a leading zero. Refused rather than normalised.
 */
export const DECIMAL_ID = /^(?:0|[1-9]\d{0,19})$/;
