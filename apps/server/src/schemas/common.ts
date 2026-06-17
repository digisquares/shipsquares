import { Type as T, type TSchema } from "@sinclair/typebox";

export const Id = T.String({ minLength: 1 });
export const Timestamp = T.String({ format: "date-time" });

export const ListQuery = T.Object({
  limit: T.Optional(T.Integer({ minimum: 1, maximum: 100, default: 25 })),
  cursor: T.Optional(T.String()),
  sort: T.Optional(T.String()),
});

export const Page = <Item extends TSchema>(item: Item) =>
  T.Object({
    data: T.Array(item),
    page: T.Object({
      nextCursor: T.Union([T.String(), T.Null()]),
      hasMore: T.Boolean(),
    }),
  });

export const Problem = T.Object({
  type: T.String(),
  title: T.String(),
  status: T.Integer(),
  code: T.String(),
  detail: T.Optional(T.String()),
  instance: T.Optional(T.String()),
  errors: T.Optional(T.Array(T.Object({ path: T.String(), message: T.String() }))),
});
