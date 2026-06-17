import { describe, expect, it } from "vitest";

import { formatPrometheusOutput, type PrometheusMetric } from "./prometheus.js";

describe("prometheus", () => {
  describe("formatPrometheusOutput", () => {
    it("formats a simple gauge metric", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "test_metric",
          type: "gauge",
          help: "A test metric",
          values: [{ labels: {}, value: 42 }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain("# HELP test_metric A test metric");
      expect(output).toContain("# TYPE test_metric gauge");
      expect(output).toContain("test_metric 42");
    });

    it("formats metrics with labels", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "http_requests_total",
          type: "counter",
          help: "Total HTTP requests",
          values: [
            { labels: { method: "GET", status: "200" }, value: 100 },
            { labels: { method: "POST", status: "201" }, value: 50 },
          ],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain('http_requests_total{method="GET",status="200"} 100');
      expect(output).toContain('http_requests_total{method="POST",status="201"} 50');
    });

    it("escapes special characters in labels", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "test_metric",
          type: "gauge",
          help: "Test",
          values: [{ labels: { path: '/api/v1/"test"' }, value: 1 }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain('path="/api/v1/\\"test\\""');
    });

    it("formats floating point values", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "cpu_usage",
          type: "gauge",
          help: "CPU usage",
          values: [{ labels: {}, value: 0.123456789 }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain("cpu_usage 0.123457"); // 6 decimal places
    });

    it("formats integer values without decimals", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "count",
          type: "counter",
          help: "Count",
          values: [{ labels: {}, value: 1000 }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain("count 1000");
      expect(output).not.toContain("count 1000."); // No trailing dot
    });

    it("handles NaN values", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "broken",
          type: "gauge",
          help: "Broken metric",
          values: [{ labels: {}, value: NaN }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain("broken NaN");
    });

    it("handles Infinity values", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "infinite",
          type: "gauge",
          help: "Infinite metric",
          values: [{ labels: {}, value: Infinity }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain("infinite NaN"); // Prometheus doesn't support Infinity
    });

    it("separates metrics with blank lines", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "metric_a",
          type: "gauge",
          help: "Metric A",
          values: [{ labels: {}, value: 1 }],
        },
        {
          name: "metric_b",
          type: "gauge",
          help: "Metric B",
          values: [{ labels: {}, value: 2 }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      // Should have blank lines between metrics
      expect(output).toMatch(/metric_a 1\n\n# HELP metric_b/);
    });

    it("escapes newlines in label values", () => {
      const metrics: PrometheusMetric[] = [
        {
          name: "test",
          type: "gauge",
          help: "Test",
          values: [{ labels: { msg: "line1\nline2" }, value: 1 }],
        },
      ];
      const output = formatPrometheusOutput(metrics);
      expect(output).toContain('msg="line1\\nline2"');
    });
  });
});
