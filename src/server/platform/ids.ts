/** The shape of a `@db.Uuid` value; anything else can never match a row, so it is a 404. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
