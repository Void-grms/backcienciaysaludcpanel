import { Injectable, Logger } from '@nestjs/common';
import { ResultFlag, ResultType } from '@prisma/client';

import type {
  ReportCategoryGroup,
  ReportContext,
  ReportResultRow,
} from './report-context';

// pdfmake CommonJS require — el paquete exporta la clase PdfPrinter directamente.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake');

const PDF_FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  private readonly printer = new PdfPrinter(PDF_FONTS);

  async renderContextToPdf(ctx: ReportContext): Promise<Buffer> {
    const docDef = this.buildDocDefinition(ctx);
    return new Promise<Buffer>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const doc = this.printer.createPdfKitDocument(docDef);
      const chunks: Buffer[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      doc.on('error', (err: Error) => {
        this.logger.error(`Error generando PDF: ${err.message}`);
        reject(err);
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      doc.end();
    });
  }

  // ---- Document definition ----
  private buildDocDefinition(ctx: ReportContext): object {
    const primary = ctx.lab.primaryColor || '#0F766E';
    return {
      pageSize: 'A4',
      // top=130pt reservado para cabecera; bottom=90pt para pie+firmas
      pageMargins: [42, 130, 42, 90],
      defaultStyle: { font: 'Helvetica', fontSize: 9, color: '#111827' },
      header: () => this.buildHeader(ctx, primary),
      footer: (page: number, total: number) => this.buildFooter(ctx, page, total),
      content: [
        ...this.buildAmendmentBanner(ctx),
        this.buildPatientCard(ctx),
        { text: ' ', margin: [0, 6, 0, 0] },
        ...this.buildCategories(ctx, primary),
        ...this.buildFlagsLegend(ctx),
      ],
    };
  }

  // ---- Header (se repite en cada pagina) ----
  private buildHeader(ctx: ReportContext, primary: string): object {
    const labStack: object[] = [];
    if (ctx.lab.logoUrl) {
      labStack.push({ image: ctx.lab.logoUrl, width: 80, height: 24, fit: [80, 24], margin: [0, 0, 0, 3] });
    } else {
      labStack.push({ text: ctx.lab.commercialName, fontSize: 11, bold: true, color: primary });
    }
    if (ctx.lab.taxId) labStack.push({ text: `RUC ${ctx.lab.taxId}`, fontSize: 7, color: '#6B7280' });
    if (ctx.lab.address) labStack.push({ text: ctx.lab.address, fontSize: 7, color: '#6B7280' });
    if (ctx.lab.phone) labStack.push({ text: `Tel: ${ctx.lab.phone}`, fontSize: 7, color: '#6B7280' });
    if (ctx.lab.email) labStack.push({ text: ctx.lab.email, fontSize: 7, color: '#6B7280' });

    const orderStack: object[] = [
      { text: ctx.order.code, fontSize: 13, bold: true },
      { text: this.stateLabel(ctx.order.state), fontSize: 7.5, color: '#6B7280', margin: [0, 1, 0, 2] },
    ];
    if (ctx.order.sampleTakenAt) orderStack.push({ text: `Muestra: ${ctx.order.sampleTakenAt}`, fontSize: 7, color: '#9CA3AF' });
    if (ctx.order.validatedAt) orderStack.push({ text: `Validada: ${ctx.order.validatedAt}`, fontSize: 7, color: '#9CA3AF' });
    if (ctx.order.deliveredAt) orderStack.push({ text: `Entregada: ${ctx.order.deliveredAt}`, fontSize: 7, color: '#9CA3AF' });

    const qrStack: object[] = ctx.qrDataUrl
      ? [
          { image: ctx.qrDataUrl, width: 60, height: 60, alignment: 'right' },
          { text: 'Verificar', fontSize: 5.5, color: '#9CA3AF', alignment: 'right' },
        ]
      : [];

    return {
      margin: [42, 12, 42, 0],
      stack: [
        {
          columns: [
            { width: '*', stack: labStack },
            { width: 160, alignment: 'center', stack: orderStack },
            { width: 72, alignment: 'right', stack: qrStack },
          ],
        },
        {
          canvas: [{ type: 'rect', x: 0, y: 6, w: 511, h: 1.5, color: primary }],
          margin: [0, 4, 0, 0],
        },
      ],
    };
  }

  // ---- Footer (se repite en cada pagina) ----
  private buildFooter(ctx: ReportContext, page: number, total: number): object {
    const sigs = ctx.professionals;
    const sigWidth = sigs.length > 0 ? Math.floor(511 / sigs.length) : 511;

    const sigCols = sigs.map((p) => {
      const col: object[] = [];
      if (p.signatureUrl) {
        col.push({ image: p.signatureUrl, width: Math.min(sigWidth - 12, 100), height: 28, fit: [100, 28], alignment: 'center' });
      } else {
        col.push({ text: ' ', margin: [0, 0, 0, 28] });
      }
      col.push({ canvas: [{ type: 'line', x1: 10, y1: 0, x2: sigWidth - 10, y2: 0, lineColor: '#9CA3AF' }] });
      col.push({ text: p.fullName, fontSize: 7.5, bold: true, alignment: 'center', margin: [0, 2, 0, 0] });
      if (p.professionalTitle) col.push({ text: p.professionalTitle, fontSize: 7, color: '#6B7280', alignment: 'center' });
      if (p.licenseNumber) col.push({ text: `Reg. ${p.licenseNumber}`, fontSize: 7, color: '#9CA3AF', alignment: 'center' });
      return { width: sigWidth, alignment: 'center', stack: col };
    });

    const footerStack: object[] = [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 511, h: 0.5, color: '#E5E7EB' }] },
    ];
    if (sigCols.length > 0) {
      footerStack.push({ columns: sigCols, margin: [0, 4, 0, 2] });
    }
    footerStack.push({ text: `Pagina ${page} de ${total}`, fontSize: 7, color: '#9CA3AF', alignment: 'right' });

    return { margin: [42, 4, 42, 4], stack: footerStack };
  }

  // ---- Amendment Banner ----
  private buildAmendmentBanner(ctx: ReportContext): object[] {
    if (!ctx.order.isAmended) return [];
    const msg = `INFORME ENMENDADO${ctx.order.previousCode ? ` — Reemplaza al informe ${ctx.order.previousCode}` : ''}`;
    return [
      {
        table: {
          widths: ['*'],
          body: [[{ text: msg, fontSize: 8, bold: true, color: '#92400E', fillColor: '#FEF3C7', alignment: 'center', margin: [8, 5, 8, 5] }]],
        },
        layout: {
          hLineWidth: () => 0.8,
          vLineWidth: () => 0.8,
          hLineColor: () => '#F59E0B',
          vLineColor: () => '#F59E0B',
        },
        margin: [0, 0, 0, 10],
      },
    ];
  }

  // ---- Patient Card ----
  private buildPatientCard(ctx: ReportContext): object {
    const p = ctx.patient;
    const o = ctx.order;
    const sexLabel = p.sex === 'M' ? 'Masculino' : p.sex === 'F' ? 'Femenino' : 'No especificado';

    const leftRows: object[] = [
      { text: 'DATOS DEL PACIENTE', fontSize: 7, bold: true, color: '#6B7280', margin: [0, 0, 0, 3] },
      this.kv('Nombre', p.fullName),
      this.kv('Documento', `${p.documentType}: ${p.documentNumber}`),
      this.kv('Sexo', sexLabel),
      this.kv('Edad', p.age),
      ...(p.birthDate ? [this.kv('Nacimiento', this.fmtDateIso(p.birthDate))] : []),
    ];

    const rightRows: object[] = [
      { text: 'DATOS DEL PEDIDO', fontSize: 7, bold: true, color: '#6B7280', margin: [0, 0, 0, 3] },
      ...(o.reference ? [this.kv('Clinica derivadora', o.reference)] : []),
      ...(o.requestingDoctor ? [this.kv('Medico solicitante', o.requestingDoctor)] : []),
      ...(o.sampleTakenAt ? [this.kv('Toma de muestra', o.sampleTakenAt)] : []),
    ];

    return {
      table: {
        widths: ['*', '*'],
        body: [[
          { stack: leftRows, margin: [8, 6, 4, 6] },
          { stack: rightRows, margin: [4, 6, 8, 6] },
        ]],
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[][] } }) =>
          i === 0 || i === node.table.body.length ? 0.5 : 0,
        vLineWidth: (i: number) => (i === 0 || i === 2 ? 0.5 : 0.3),
        hLineColor: () => '#D1D5DB',
        vLineColor: () => '#D1D5DB',
      },
    };
  }

  private kv(label: string, value: string): object {
    return {
      columns: [
        { text: `${label}:`, width: 85, fontSize: 8, color: '#6B7280' },
        { text: value, width: '*', fontSize: 8, bold: true },
      ],
      margin: [0, 0, 0, 2],
    };
  }

  // ---- Categories + Results ----
  private buildCategories(ctx: ReportContext, primary: string): object[] {
    const out: object[] = [];
    for (const cat of ctx.categories) {
      out.push(this.buildCategoryHeader(cat, primary));
      for (const panel of cat.panels) {
        if (panel.panelName) {
          out.push({ text: panel.panelName, fontSize: 8, italics: true, color: '#6B7280', margin: [4, 3, 0, 2] });
        }
        out.push(this.buildResultsTable(panel.rows, cat.showMethodColumn));
      }
    }
    return out;
  }

  private buildCategoryHeader(cat: ReportCategoryGroup, primary: string): object {
    return {
      table: {
        widths: ['*'],
        body: [[{
          text: cat.categoryName.toUpperCase(),
          fontSize: 9, bold: true, color: '#FFFFFF',
          fillColor: cat.categoryColor || primary,
          margin: [8, 4, 8, 4],
        }]],
      },
      layout: 'noBorders',
      margin: [0, 8, 0, 2],
    };
  }

  private buildResultsTable(rows: ReportResultRow[], showMethod: boolean): object {
    const widths = showMethod ? ['*', 80, 40, 40, 115] : ['*', 80, 40, 130];

    const headerRow = showMethod
      ? [this.th('Prueba'), this.th('Resultado', 'center'), this.th('Unidad', 'center'), this.th('Metodo'), this.th('Valor Referencial')]
      : [this.th('Prueba'), this.th('Resultado', 'center'), this.th('Unidad', 'center'), this.th('Valor Referencial')];

    return {
      table: {
        widths,
        headerRows: 1,
        body: [headerRow, ...rows.map((r) => this.buildResultRow(r, showMethod))],
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[][] } }) =>
          i === 0 || i === node.table.body.length ? 0.5 : 0.3,
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 0 ? '#9CA3AF' : '#F3F4F6'),
        fillColor: (row: number) => (row === 0 ? '#F9FAFB' : row % 2 === 0 ? '#FAFAFA' : null),
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => 4,
        paddingBottom: () => 3,
      },
      margin: [0, 0, 0, 4],
    };
  }

  private th(text: string, align: 'left' | 'center' | 'right' = 'left'): object {
    return { text, fontSize: 7.5, bold: true, color: '#374151', alignment: align };
  }

  private buildResultRow(row: ReportResultRow, showMethod: boolean): object[] {
    const hasFlag = row.flag !== 'none' && row.flag !== 'normal';
    const flagColor = this.flagColor(row.flag as ResultFlag);
    const flagCode = this.flagShort(row.flag as ResultFlag);

    // Celda: valor del resultado
    let resultCell: object;
    if (row.resultType === ResultType.numeric && row.valueNumeric != null) {
      const numStr = row.valueNumeric.toLocaleString('es-PE', {
        minimumFractionDigits: row.decimals,
        maximumFractionDigits: row.decimals,
      });
      resultCell = hasFlag
        ? { text: [{ text: numStr, bold: true, color: flagColor }, { text: `  ${flagCode}`, fontSize: 7, bold: true, color: flagColor }], alignment: 'center' }
        : { text: numStr, bold: true, alignment: 'center' };
    } else if (row.valueText) {
      resultCell = { text: row.valueText, bold: hasFlag, color: hasFlag ? flagColor : '#111827', alignment: 'center' };
    } else {
      resultCell = { text: '—', color: '#9CA3AF', alignment: 'center' };
    }

    if (row.observation) {
      resultCell = { stack: [resultCell, { text: row.observation, fontSize: 7, italics: true, color: '#6B7280' }] };
    }

    // Celda: rango de referencia
    const rangeCell = row.ranges.length > 0
      ? { stack: row.ranges.map((rng) => ({ text: rng.text, fontSize: 7.5, color: rng.highlighted ? '#0F766E' : '#9CA3AF', bold: rng.highlighted })) }
      : { text: '—', fontSize: 7.5, color: '#D1D5DB' };

    // Celda: nombre de la prueba + codigo
    const nameCell = {
      stack: [
        { text: row.testName, fontSize: 8.5 },
        { text: row.testCode, fontSize: 7, color: '#9CA3AF' },
      ],
    };

    const cells: object[] = [
      nameCell,
      resultCell,
      { text: row.unit ?? '—', fontSize: 7.5, color: '#6B7280', alignment: 'center' },
    ];
    if (showMethod) cells.push({ text: row.method ?? '—', fontSize: 7.5, color: '#6B7280' });
    cells.push(rangeCell);
    return cells;
  }

  // ---- Flags Legend ----
  private buildFlagsLegend(ctx: ReportContext): object[] {
    if (ctx.flagsLegend.length === 0) return [];
    const text = ctx.flagsLegend.map((f) => `[${f.code}] ${f.label}`).join('   ');
    return [{ text: `Leyenda: ${text}`, fontSize: 7, color: '#6B7280', italics: true, margin: [0, 8, 0, 0] }];
  }

  // ---- Helpers ----
  private stateLabel(state: string): string {
    const MAP: Record<string, string> = {
      draft: 'Borrador',
      in_progress: 'En proceso',
      validated: 'Validado',
      delivered: 'Entregado',
      amended: 'Enmendado',
      cancelled: 'Cancelado',
    };
    return MAP[state] ?? state;
  }

  private flagColor(flag: ResultFlag): string {
    if (flag === ResultFlag.critical_high || flag === ResultFlag.critical_low) return '#DC2626';
    if (flag === ResultFlag.high || flag === ResultFlag.low) return '#D97706';
    if (flag === ResultFlag.abnormal) return '#7C3AED';
    return '#111827';
  }

  private flagShort(flag: ResultFlag): string {
    const MAP: Record<string, string> = {
      critical_high: 'HH',
      critical_low: 'LL',
      high: 'H',
      low: 'L',
      abnormal: '!',
    };
    return MAP[flag] ?? '';
  }

  private fmtDateIso(iso: string): string {
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    } catch {
      return iso;
    }
  }
}
