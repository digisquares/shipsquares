import { describe, expect, it } from "vitest";

import {
  createPublicationSql,
  createSubscriptionSql,
  dropPublicationSql,
  dropSubscriptionSql,
  publicationName,
  replicationConnString,
  slotName,
  subscriptionName,
} from "./replication.js";

const target = {
  host: "10.0.0.5",
  port: 5432,
  user: "shop_app",
  password: "p w'x",
  database: "shop",
};

describe("identifier helpers", () => {
  it("derives stable, sql-safe names from the replica id", () => {
    expect(publicationName("rpl_AbC123")).toBe("ss_pub_rpl_abc123");
    expect(subscriptionName("rpl_AbC123")).toBe("ss_sub_rpl_abc123");
    expect(slotName("rpl_AbC123")).toBe("ss_slot_rpl_abc123");
  });

  it("strips non-alphanumerics so the names can't break SQL", () => {
    expect(slotName("rpl-x.y/z")).toBe("ss_slot_rpl_x_y_z");
  });
});

describe("publication / subscription SQL (logical replication)", () => {
  it("publishes all tables on the primary", () => {
    expect(createPublicationSql("rpl_1")).toBe('CREATE PUBLICATION "ss_pub_rpl_1" FOR ALL TABLES;');
    expect(dropPublicationSql("rpl_1")).toBe('DROP PUBLICATION IF EXISTS "ss_pub_rpl_1";');
  });

  it("subscribes on the replica with a single-quote-escaped connection string", () => {
    const sql = createSubscriptionSql("rpl_1", target);
    expect(sql).toContain('CREATE SUBSCRIPTION "ss_sub_rpl_1"');
    expect(sql).toContain("CONNECTION '");
    expect(sql).toContain('PUBLICATION "ss_pub_rpl_1"');
    // libpq-quoted value: password='p w\'x' → SQL-literal doubling of every quote
    expect(sql).toContain("password=''p w\\''x''");
    expect(dropSubscriptionSql("rpl_1")).toBe('DROP SUBSCRIPTION IF EXISTS "ss_sub_rpl_1";');
  });
});

describe("replicationConnString", () => {
  it("libpq-quotes every value so spaces/quotes can't break or inject conninfo", () => {
    expect(replicationConnString(target)).toBe(
      "host='10.0.0.5' port='5432' user='shop_app' password='p w\\'x' dbname='shop'",
    );
  });

  it("escapes a backslash in a value", () => {
    expect(replicationConnString({ ...target, password: "a\\b" })).toContain("password='a\\\\b'");
  });
});
