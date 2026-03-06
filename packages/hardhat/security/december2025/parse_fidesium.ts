/**
 * Fidesium Security Report Parser
 * Parses the SARIF JSON format and outputs a summary of findings
 */

import * as fs from "fs";
import * as path from "path";

interface Rule {
  id: string;
  name: string;
  shortDescription: { text: string };
  properties: {
    tags: string[];
    "security-severity": string;
  };
}

interface Result {
  ruleId: string;
  message: { text: string };
  locations?: {
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: {
        startLine: number;
        endLine?: number;
      };
    };
  }[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      rules: Rule[];
    };
  };
  results: Result[];
}

interface SarifReport {
  runs: SarifRun[];
}

function parseReport(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const report: SarifReport = JSON.parse(raw);

  const run = report.runs[0];
  const rulesMap = new Map<string, Rule>();

  // Build rules lookup
  for (const rule of run.tool.driver.rules) {
    rulesMap.set(rule.id, rule);
  }

  // Group results by severity and rule
  const findings: {
    high: Map<string, Result[]>;
    medium: Map<string, Result[]>;
    low: Map<string, Result[]>;
    info: Map<string, Result[]>;
  } = {
    high: new Map(),
    medium: new Map(),
    low: new Map(),
    info: new Map(),
  };

  for (const result of run.results) {
    const rule = rulesMap.get(result.ruleId);
    if (!rule) continue;

    const severity = rule.properties.tags.find(t => t.startsWith("security/"));
    let category: keyof typeof findings = "info";

    if (severity?.includes("high") || severity?.includes("critical")) {
      category = "high";
    } else if (severity?.includes("medium")) {
      category = "medium";
    } else if (severity?.includes("low")) {
      category = "low";
    }

    if (!findings[category].has(result.ruleId)) {
      findings[category].set(result.ruleId, []);
    }
    findings[category].get(result.ruleId)!.push(result);
  }

  // Output summary
  console.log("=".repeat(80));
  console.log("FIDESIUM SECURITY REPORT SUMMARY");
  console.log("=".repeat(80));
  console.log();

  const printCategory = (name: string, categoryFindings: Map<string, Result[]>) => {
    if (categoryFindings.size === 0) {
      console.log(`${name.toUpperCase()}: 0 findings\n`);
      return;
    }

    let totalCount = 0;
    categoryFindings.forEach(results => (totalCount += results.length));
    console.log(`${name.toUpperCase()}: ${totalCount} findings across ${categoryFindings.size} rule types\n`);

    categoryFindings.forEach((results, ruleId) => {
      const rule = rulesMap.get(ruleId);
      console.log(`  [${ruleId}] ${rule?.name || ruleId}`);
      console.log(`    Count: ${results.length}`);

      // Show first 3 locations
      const locations = results
        .slice(0, 3)
        .filter(r => r.locations?.length)
        .map(r => {
          const loc = r.locations![0].physicalLocation;
          const file = loc.artifactLocation.uri.split("/").pop();
          const line = loc.region?.startLine || "?";
          return `${file}:${line}`;
        });

      if (locations.length > 0) {
        console.log(
          `    Locations: ${locations.join(", ")}${results.length > 3 ? ` (+${results.length - 3} more)` : ""}`,
        );
      }

      // Show message excerpt
      if (results[0].message?.text) {
        const msg = results[0].message.text.slice(0, 100);
        console.log(`    Message: ${msg}${results[0].message.text.length > 100 ? "..." : ""}`);
      }
      console.log();
    });
  };

  printCategory("HIGH", findings.high);
  printCategory("MEDIUM", findings.medium);
  printCategory("LOW", findings.low);

  console.log("=".repeat(80));
  console.log("DETAILED FINDINGS FOR ACTIONABLE ITEMS:");
  console.log("=".repeat(80));
  console.log();

  // Print details for high and medium findings
  ["high", "medium"].forEach(sev => {
    const cat = findings[sev as keyof typeof findings];
    cat.forEach((results, ruleId) => {
      const rule = rulesMap.get(ruleId);
      console.log(`\n### ${rule?.name || ruleId} (${sev.toUpperCase()})`);
      console.log(`Rule ID: ${ruleId}`);
      console.log(`Description: ${rule?.shortDescription.text || "N/A"}`);
      console.log(`\nOccurrences:`);

      results.forEach((r, i) => {
        if (r.locations?.length) {
          const loc = r.locations[0].physicalLocation;
          console.log(
            `  ${i + 1}. ${loc.artifactLocation.uri}:${loc.region?.startLine || "?"}-${loc.region?.endLine || "?"}`,
          );
        }
        if (r.message?.text && r.message.text !== rule?.shortDescription.text) {
          console.log(`     Message: ${r.message.text.slice(0, 200)}`);
        }
      });
    });
  });

  // Summary stats
  const highCount = Array.from(findings.high.values()).reduce((a, b) => a + b.length, 0);
  const medCount = Array.from(findings.medium.values()).reduce((a, b) => a + b.length, 0);
  const lowCount = Array.from(findings.low.values()).reduce((a, b) => a + b.length, 0);

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY STATS:");
  console.log(`  HIGH:   ${highCount}`);
  console.log(`  MEDIUM: ${medCount}`);
  console.log(`  LOW:    ${lowCount}`);
  console.log(`  TOTAL:  ${highCount + medCount + lowCount}`);
  console.log("=".repeat(80));
}

// Run
const reportPath = path.join(__dirname, "unlloo_fidesium_v2.json");
parseReport(reportPath);
