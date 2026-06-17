import { describe, expect, it } from "vitest";

import {
  backupFilename,
  deleteFileCommand,
  dumpCommand,
  dumpCommandHost,
  listFilesCommand,
  parseBackupTimestamp,
  restorePipelineHost,
  restorePipeline,
  s3Remote,
  shq,
  sizeCommand,
  uploadPipeline,
} from "./commands.js";

const DEST = {
  provider: "AWS",
  accessKeyId: "AKIA123",
  secretAccessKey: "SK456",
  region: "eu-central-1",
  endpoint: "",
  bucket: "backups",
};

describe("shq (shell single-quote)", () => {
  it("wraps plain values and escapes embedded quotes", () => {
    expect(shq("shop")).toBe("'shop'");
    expect(shq("a'b")).toBe("'a'\\''b'");
    expect(shq("$(rm -rf /)")).toBe("'$(rm -rf /)'"); // no expansion inside single quotes
  });
});

describe("dumpCommand", () => {
  it("postgres: pg_dump custom format piped to gzip", () => {
    expect(
      dumpCommand({ engine: "postgres", container: "db-1", user: "app", database: "shop" }),
    ).toBe("docker exec 'db-1' pg_dump -Fc --no-acl --no-owner -U 'app' 'shop' | gzip");
  });

  it("mysql/mariadb: single-transaction dump with attached password", () => {
    expect(
      dumpCommand({
        engine: "mysql",
        container: "db-1",
        user: "root",
        password: "pw",
        database: "shop",
      }),
    ).toBe("docker exec 'db-1' mysqldump --single-transaction -u 'root' -p'pw' 'shop' | gzip");
    expect(
      dumpCommand({
        engine: "mariadb",
        container: "db-1",
        user: "root",
        password: "pw",
        database: "shop",
      }),
    ).toBe("docker exec 'db-1' mariadb-dump --single-transaction -u 'root' -p'pw' 'shop' | gzip");
  });

  it("quotes injection attempts in every field (exact escaped form)", () => {
    const cmd = dumpCommand({
      engine: "postgres",
      container: "db-1",
      user: "app",
      database: "shop'; rm -rf /; '",
    });
    // The whole malicious value stays inside single quotes; embedded quotes
    // become the '\'' escape so nothing ever executes.
    expect(cmd).toBe(
      "docker exec 'db-1' pg_dump -Fc --no-acl --no-owner -U 'app' " +
        "'shop'\\''; rm -rf /; '\\''' | gzip",
    );
  });
});

describe("dumpCommandHost (managed host PG, 24)", () => {
  it("pg_dump against a host with the password via env assignment (not argv)", () => {
    expect(
      dumpCommandHost({
        host: "10.0.0.5",
        port: 5432,
        user: "shop_app",
        password: "pw",
        database: "shop",
      }),
    ).toBe(
      "PGPASSWORD='pw' pg_dump -Fc --no-acl --no-owner -h '10.0.0.5' -p 5432 -U 'shop_app' 'shop' | gzip",
    );
  });

  it("escapes quotes in host/user/db/password", () => {
    const cmd = dumpCommandHost({
      host: "h",
      port: 5433,
      user: "u'x",
      password: "p'w",
      database: "d",
    });
    expect(cmd).toContain("PGPASSWORD='p'\\''w'");
    expect(cmd).toContain("-U 'u'\\''x'");
    expect(cmd).toContain("-p 5433");
  });
});

describe("restorePipeline", () => {
  it("postgres: rclone cat → gunzip → pg_restore over stdin", () => {
    expect(
      restorePipeline(":s3,provider=AWS:backups/f.gz", {
        engine: "postgres",
        container: "db-1",
        user: "app",
        database: "shop",
      }),
    ).toBe(
      "rclone cat ':s3,provider=AWS:backups/f.gz' | gunzip -c | " +
        "docker exec -i 'db-1' pg_restore --clean --if-exists -U 'app' -d 'shop'",
    );
  });

  it("mysql: pipes plain sql into the client", () => {
    expect(
      restorePipeline(":s3:b/f.gz", {
        engine: "mysql",
        container: "db-1",
        user: "root",
        password: "pw",
        database: "shop",
      }),
    ).toBe(
      "rclone cat ':s3:b/f.gz' | gunzip -c | docker exec -i 'db-1' mysql -u 'root' -p'pw' 'shop'",
    );
  });
});

describe("restorePipelineHost (managed host PG)", () => {
  it("rclone cat → gunzip → pg_restore against the host, password via env", () => {
    expect(
      restorePipelineHost(":s3,provider=AWS:backups/org_1/shop/f.dump.gz", {
        host: "10.0.0.5",
        port: 5432,
        user: "shop_app",
        password: "pw",
        database: "shop",
      }),
    ).toBe(
      "rclone cat ':s3,provider=AWS:backups/org_1/shop/f.dump.gz' | gunzip -c | " +
        "PGPASSWORD='pw' pg_restore --clean --if-exists -h '10.0.0.5' -p 5432 -U 'shop_app' -d 'shop'",
    );
  });
});

describe("s3Remote", () => {
  it("composes the inline rclone remote, omitting empty fields", () => {
    expect(s3Remote(DEST, "shop/shop-x.dump.gz")).toBe(
      ":s3,provider=AWS,access_key_id=AKIA123,secret_access_key=SK456,region=eu-central-1:backups/shop/shop-x.dump.gz",
    );
  });

  it("double-quotes values containing commas or spaces", () => {
    const remote = s3Remote({ ...DEST, secretAccessKey: "a,b c" }, "f.gz");
    expect(remote).toContain('secret_access_key="a,b c"');
  });

  it("double-quotes an endpoint URL so its port colon doesn't split the path", () => {
    const remote = s3Remote({ ...DEST, endpoint: "http://127.0.0.1:9000" }, "p/f.gz");
    expect(remote).toContain('endpoint="http://127.0.0.1:9000"');
    expect(remote.endsWith(":backups/p/f.gz")).toBe(true);
  });
});

describe("uploadPipeline / backupFilename", () => {
  it("pipes the dump into rclone rcat", () => {
    expect(uploadPipeline("pg_dump | gzip", ":s3:b/f.gz")).toBe(
      "pg_dump | gzip | rclone rcat ':s3:b/f.gz'",
    );
  });

  it("builds a sortable, colon-free filename from an injected clock", () => {
    expect(backupFilename("shop", new Date("2026-06-10T12:30:05.000Z"))).toBe(
      "shop-2026-06-10T12-30-05.dump.gz",
    );
  });
});

describe("size / list / delete commands", () => {
  it("probes one object's size as JSON", () => {
    expect(sizeCommand(":s3:b/shop/f.dump.gz")).toBe("rclone size ':s3:b/shop/f.dump.gz' --json");
  });

  it("lists only files in a remote dir", () => {
    expect(listFilesCommand(":s3:backups/shop")).toBe("rclone lsf ':s3:backups/shop' --files-only");
  });

  it("deletes exactly one remote object", () => {
    expect(deleteFileCommand(":s3:b/shop/f.dump.gz")).toBe(
      "rclone deletefile ':s3:b/shop/f.dump.gz'",
    );
  });
});

describe("parseBackupTimestamp", () => {
  it("round-trips backupFilename, including hyphenated database names", () => {
    const at = new Date("2026-06-10T12:30:05.000Z");
    expect(parseBackupTimestamp(backupFilename("shop", at))).toBe(at.getTime());
    expect(parseBackupTimestamp(backupFilename("my-app-db", at))).toBe(at.getTime());
    // physical base bundle (.tar) parses too
    expect(parseBackupTimestamp(backupFilename("basebackup", at, "tar"))).toBe(at.getTime());
  });

  it("returns null for foreign files so they are never pruned", () => {
    expect(parseBackupTimestamp("notes.txt")).toBeNull();
    expect(parseBackupTimestamp("shop.dump.gz")).toBeNull();
    expect(parseBackupTimestamp("")).toBeNull();
  });

  it("returns null for an impossible calendar date", () => {
    expect(parseBackupTimestamp("shop-2026-13-40T12-00-00.dump.gz")).toBeNull();
  });
});
