/**
 * Export Interaction Report as PDF using browser print API.
 * Creates a hidden iframe with styled HTML and triggers window.print().
 * No external dependencies required.
 */

export interface ExportDrugInfo {
  id: string;
  name: string;
}

export interface ExportInteraction {
  drug_a_id: string;
  drug_a_name: string;
  drug_b_id: string;
  drug_b_name: string;
  severity: string;
  description: string | null;
}

export interface ExportReportData {
  drugs: ExportDrugInfo[];
  interactions: ExportInteraction[];
  riskScore: number;
  riskLevel: string;
  majorCount: number;
  moderateCount: number;
  minorCount: number;
  patientName?: string;
  patientId?: string;
}

function severityColor(sev: string): string {
  switch (sev) {
    case "major": return "#dc2626";
    case "moderate": return "#d97706";
    case "minor": return "#16a34a";
    default: return "#6b7280";
  }
}

function severityLabel(sev: string): string {
  switch (sev) {
    case "major": return "HIGH";
    case "moderate": return "MODERATE";
    case "minor": return "LOW";
    default: return "UNKNOWN";
  }
}

function getRiskRecommendations(riskLevel: string): string[] {
  switch (riskLevel) {
    case "high":
      return [
        "Avoid concurrent use of high-risk drug combinations when possible.",
        "Seek alternative medications with lower interaction potential.",
        "If unavoidable, implement close monitoring of plasma levels and vital signs.",
        "Consult a clinical pharmacist for dose adjustment recommendations.",
      ];
    case "moderate":
      return [
        "Monitor patient closely for signs of adverse effects.",
        "Consider dose adjustment if adverse effects appear.",
        "Schedule follow-up appointments to assess tolerability.",
        "Document interactions in patient medical record.",
      ];
    default:
      return [
        "Routine monitoring is generally sufficient.",
        "Inform patient about potential mild interactions.",
        "Standard prescribing practices apply.",
        "Document in medical record for reference.",
      ];
  }
}

export function exportInteractionReport(data: ExportReportData): void {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit",
  });

  const recommendations = getRiskRecommendations(data.riskLevel);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MediDB — Drug Interaction Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1f2937;
      line-height: 1.5;
      padding: 40px;
      font-size: 12px;
    }
    .header {
      border-bottom: 3px solid #1d4ed8;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 20px;
      color: #1d4ed8;
      margin-bottom: 4px;
    }
    .header .subtitle {
      font-size: 11px;
      color: #6b7280;
    }
    .section {
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .patient-info {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
    }
    .drug-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .drug-chip {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      color: #1e40af;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin-bottom: 12px;
    }
    th {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      padding: 8px 10px;
      text-align: left;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #4b5563;
    }
    td {
      border: 1px solid #e5e7eb;
      padding: 7px 10px;
      vertical-align: top;
    }
    .severity-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      color: white;
    }
    .risk-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 16px;
    }
    .risk-box.moderate {
      background: #fffbeb;
      border-color: #fde68a;
    }
    .risk-box.low {
      background: #f0fdf4;
      border-color: #bbf7d0;
    }
    .risk-label {
      font-size: 14px;
      font-weight: 800;
    }
    .recommendations li {
      margin-bottom: 6px;
      padding-left: 4px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 10px;
      color: #9ca3af;
      text-align: center;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>MediDB — Drug Interaction Report</h1>
    <div class="subtitle">Generated on ${dateStr} at ${timeStr}</div>
  </div>

  ${data.patientName || data.patientId ? `
  <div class="patient-info">
    <strong>Patient:</strong> ${data.patientName || "N/A"}
    ${data.patientId ? ` &nbsp;|&nbsp; <strong>ID:</strong> ${data.patientId}` : ""}
  </div>
  ` : ""}

  <div class="section">
    <div class="section-title">Medications Checked (${data.drugs.length})</div>
    <div class="drug-list">
      ${data.drugs.map(d => `<span class="drug-chip">${d.name} (${d.id})</span>`).join("")}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Interaction Analysis</div>
    ${data.interactions.length > 0 ? `
    <table>
      <thead>
        <tr>
          <th>Drug A</th>
          <th>Drug B</th>
          <th>Severity</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${data.interactions.map(ix => `
        <tr>
          <td><strong>${ix.drug_a_name}</strong></td>
          <td><strong>${ix.drug_b_name}</strong></td>
          <td>
            <span class="severity-badge" style="background:${severityColor(ix.severity)}">
              ${severityLabel(ix.severity)}
            </span>
          </td>
          <td>${(ix.description || "No description available").slice(0, 200)}${(ix.description || "").length > 200 ? "…" : ""}</td>
        </tr>
        `).join("")}
      </tbody>
    </table>
    ` : `<p style="color:#6b7280;font-style:italic;">No drug-drug interactions found for this combination.</p>`}
  </div>

  <div class="section">
    <div class="section-title">Risk Assessment</div>
    <div class="risk-box ${data.riskLevel === "moderate" ? "moderate" : data.riskLevel === "low" ? "low" : ""}">
      <div class="risk-label" style="color:${data.riskLevel === "high" ? "#dc2626" : data.riskLevel === "moderate" ? "#d97706" : "#16a34a"}">
        Risk Level: ${data.riskLevel.toUpperCase()} &nbsp;(Score: ${data.riskScore}/3)
      </div>
      <div style="margin-top:6px;font-size:11px;color:#4b5563;">
        Major: ${data.majorCount} &nbsp;|&nbsp; Moderate: ${data.moderateCount} &nbsp;|&nbsp; Minor: ${data.minorCount}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Clinical Recommendations</div>
    <ul class="recommendations">
      ${recommendations.map(r => `<li>${r}</li>`).join("")}
    </ul>
  </div>

  <div class="footer">
    Generated by MediDB CDSS — Data from DrugBank v5<br>
    This report is for informational purposes only. Always consult a healthcare professional for clinical decisions.
  </div>
</body>
</html>`;

  // Create hidden iframe and trigger print
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.left = "-10000px";
  iframe.style.width = "210mm";
  iframe.style.height = "297mm";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  // Wait for content to render then print
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Clean up after print dialog closes
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  }, 300);
}
