import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { fromDbDate, todaySast } from '../common/dates';
import { formatDate, formatDateTime, formatRand, FREQUENCY_LABEL, METHOD_LABEL, PRODUCT_LABEL } from '../common/util';
import { LedgerService } from '../loans/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';

const GOLD = '#B8913A';
const INK = '#111111';
const MUTED = '#6B6B6B';
const LINE = '#E4DCC8';

type Doc = PDFKit.PDFDocument;

/** Branded PDFs: payment receipts, repayment statements and settlement confirmations. */
@Injectable()
export class PdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
  ) {}

  private async render(build: (doc: Doc) => Promise<void> | void): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Producer: 'Tee Que Financial Solutions' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    await build(doc);
    // Footer on every page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer sits inside the bottom margin; without this pdfkit would start a new page for it.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7.5).fillColor(MUTED).text(`Page ${i + 1} of ${range.count}  ·  Generated ${formatDateTime(new Date())}`, 50, doc.page.height - 40, {
        width: doc.page.width - 100,
        align: 'center',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
    return done;
  }

  private async header(doc: Doc, title: string, subtitle?: string) {
    const s = await this.settings.get();
    const left = 50;
    // Monogram
    doc.save();
    doc.roundedRect(left, 45, 42, 42, 8).fill(INK);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text('TQ', left, 57, { width: 42, align: 'center' });
    doc.moveTo(left + 8, 80).quadraticCurveTo(left + 21, 72, left + 36, 76).lineWidth(1.6).strokeColor(GOLD).stroke();
    doc.restore();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(s.companyName.toUpperCase(), left + 54, 48, { characterSpacing: 1.5 });
    doc.fillColor(GOLD).font('Helvetica-Oblique').fontSize(9).text(s.tagline, left + 54, 66);
    const contact = [s.address, [s.phone, s.email].filter(Boolean).join('  ·  '), s.ncrRegistrationNumber ? `NCR registration ${s.ncrRegistrationNumber}` : '']
      .filter(Boolean)
      .join('\n');
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(contact, 330, 48, { width: 215, align: 'right' });
    doc.moveTo(left, 100).lineTo(545, 100).lineWidth(1).strokeColor(GOLD).stroke();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(title, left, 115);
    if (subtitle) doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(subtitle, left, 136);
    doc.moveDown(1.5);
    doc.x = left;
  }

  /** Two-column label/value rows. */
  private kv(doc: Doc, rows: [string, string][], x = 50, width = 495) {
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(k, x, y, { width: width * 0.45 });
      doc.font('Helvetica-Bold').fillColor(INK).text(v, x + width * 0.45, y, { width: width * 0.55, align: 'right' });
      doc.moveDown(0.35);
    }
    doc.x = 50;
  }

  private table(doc: Doc, cols: { label: string; width: number; align?: 'left' | 'right' }[], rows: string[][], opts: { boldLast?: boolean } = {}) {
    const x0 = 50;
    const drawHeader = () => {
      let x = x0;
      const y = doc.y;
      doc.rect(x0, y - 3, cols.reduce((s, c) => s + c.width, 0), 16).fill('#F6F1E4');
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8);
      for (const c of cols) {
        doc.text(c.label, x + 3, y, { width: c.width - 6, align: c.align ?? 'left' });
        x += c.width;
      }
      doc.y = y + 16;
    };
    drawHeader();
    rows.forEach((r, ri) => {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
        doc.y = 50;
        drawHeader();
      }
      let x = x0;
      const y = doc.y;
      const bold = opts.boldLast && ri === rows.length - 1;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(INK);
      let h = 0;
      r.forEach((cell, i) => {
        const c = cols[i];
        doc.text(cell, x + 3, y, { width: c.width - 6, align: c.align ?? 'left' });
        h = Math.max(h, doc.y - y);
        x += c.width;
      });
      doc.y = y + Math.max(h, 10) + 3;
      doc.moveTo(x0, doc.y - 1.5).lineTo(x0 + cols.reduce((s, c) => s + c.width, 0), doc.y - 1.5).lineWidth(0.5).strokeColor(LINE).stroke();
    });
    doc.x = 50;
    doc.moveDown(0.5);
  }

  private section(doc: Doc, title: string) {
    doc.moveDown(0.6);
    doc.x = 50;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD).text(title.toUpperCase(), { characterSpacing: 0.8 });
    doc.moveDown(0.4);
  }

  async receipt(paymentId: string): Promise<{ fileName: string; pdf: Buffer }> {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { loan: { include: { client: true } }, allocations: { where: { supersededAt: null } }, adjustments: true },
    });
    if (!p) throw new NotFoundException('Payment not found');
    const recorder = await this.prisma.user.findUnique({ where: { id: p.recordedById }, select: { name: true } });
    const { state } = await this.ledger.state(this.prisma as never, p.loanId);
    const alloc = state.allocations.find((a) => a.paymentId === p.id);
    const pdf = await this.render(async (doc) => {
      await this.header(doc, 'Payment receipt', `Receipt ${p.transactionNumber}`);
      if (p.status !== 'CONFIRMED') {
        const label =
          p.status === 'PENDING_VERIFICATION' ? 'AWAITING VERIFICATION: NOT YET APPLIED TO THE BALANCE' : p.status === 'REVERSED' ? 'REVERSED: THIS PAYMENT NO LONGER COUNTS' : 'REJECTED: NOT RECEIVED';
        doc.rect(50, doc.y, 495, 22).fill('#FDECEC');
        doc.fillColor('#9B1C1C').font('Helvetica-Bold').fontSize(9).text(label, 50, doc.y + 7, { width: 495, align: 'center' });
        doc.moveDown(1.2);
      }
      this.kv(doc, [
        ['Client', `${p.loan.client.firstName} ${p.loan.client.lastName} (${p.loan.client.clientNumber})`],
        ['Loan reference', p.loan.reference],
        ['Amount received', formatRand(p.amountCents)],
        ['Payment date', formatDate(fromDbDate(p.paymentDate))],
        ['Payment method', METHOD_LABEL[p.method]],
        ['Payment reference', p.reference ?? '—'],
        ['Recorded', `${formatDateTime(p.recordedAt)} by ${recorder?.name ?? '—'}`],
      ]);
      if (p.status === 'CONFIRMED' && alloc) {
        this.section(doc, 'How this payment was applied');
        const rows: [string, string][] = [
          ['Interest', formatRand(alloc.interestCents)],
          ['Fees and charges', formatRand(alloc.feesCents)],
          ['Principal', formatRand(alloc.principalCents)],
        ];
        if (alloc.overpaymentCents) rows.push(['Overpayment (held for review)', formatRand(alloc.overpaymentCents)]);
        this.kv(doc, rows);
        if (alloc.instalments.length) {
          doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`Applied to instalment${alloc.instalments.length > 1 ? 's' : ''} ${alloc.instalments.map((i) => `#${i.seq % 1000} (${formatRand(i.amountCents)})`).join(', ')}.`);
          doc.moveDown(0.4);
        }
        this.section(doc, 'Balance');
        this.kv(doc, [
          ['Balance after this payment', formatRand(alloc.balanceAfterCents)],
          [`Outstanding balance today (${formatDate(todaySast())})`, formatRand(state.totalCents)],
        ]);
      }
      doc.moveDown(1.5);
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text('Thank you for your payment. Please keep this receipt for your records.', { align: 'center' });
    });
    return { fileName: `Receipt-${p.transactionNumber}.pdf`, pdf };
  }

  async statement(loanId: string): Promise<{ fileName: string; pdf: Buffer }> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        client: true,
        instalments: { orderBy: [{ dueDate: 'asc' }, { version: 'asc' }, { seq: 'asc' }] },
        payments: { orderBy: [{ paymentDate: 'asc' }, { recordedAt: 'asc' }] },
        adjustments: { orderBy: { effectiveDate: 'asc' } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    const { state } = await this.ledger.state(this.prisma as never, loanId);
    const allocById = new Map(state.allocations.map((a) => [a.paymentId, a]));
    const pdf = await this.render(async (doc) => {
      await this.header(doc, 'Repayment statement', `${loan.reference}  ·  Statement date ${formatDate(todaySast())}`);
      this.kv(doc, [
        ['Client', `${loan.client.firstName} ${loan.client.lastName} (${loan.client.clientNumber})`],
        ['ID number', loan.client.idNumber],
        ['Product', PRODUCT_LABEL[loan.product]],
        ['Loan amount', formatRand(loan.loanAmountCents)],
        ['Initiation fee', formatRand(loan.initiationFeeCents)],
        ['Interest rate', `${(loan.monthlyRateBps / 100).toFixed(2)}% per month (flat, on ${formatRand(loan.principalDebtCents)})`],
        ['Service fee', `${formatRand(loan.serviceFeeCents)} per instalment`],
        ['Repayments', `${FREQUENCY_LABEL[loan.frequency]}, ${formatRand(loan.instalmentCents)}`],
        ['Disbursed', formatDate(fromDbDate(loan.disbursedOn))],
      ]);

      this.section(doc, 'Account summary');
      this.kv(doc, [
        ['Total paid', formatRand(state.totalPaidCents)],
        ['Principal outstanding', formatRand(state.principalCents)],
        ['Interest outstanding', formatRand(state.interestCents)],
        ...(state.futureInterestCents ? ([['  of which not yet due', formatRand(state.futureInterestCents)]] as [string, string][]) : []),
        ['Fees outstanding', formatRand(state.feesCents)],
        ['Total outstanding (settlement amount today)', formatRand(state.totalCents)],
        ['Amount in arrears', formatRand(state.arrearsCents)],
        ...(state.overpaymentCents ? ([['Overpayment held', formatRand(state.overpaymentCents)]] as [string, string][]) : []),
        ...(state.settledOn ? ([['Settled on', formatDate(state.settledOn)]] as [string, string][]) : []),
      ]);

      this.section(doc, 'Transactions');
      const rows = loan.payments.map((p) => {
        const a = allocById.get(p.id);
        const status = p.status === 'CONFIRMED' ? '' : p.status === 'PENDING_VERIFICATION' ? ' (awaiting verification)' : p.status === 'REVERSED' ? ' (reversed)' : ' (rejected)';
        return [
          formatDate(fromDbDate(p.paymentDate)),
          `${p.transactionNumber}${status}`,
          METHOD_LABEL[p.method],
          formatRand(p.amountCents),
          a ? formatRand(a.interestCents) : '—',
          a ? formatRand(a.feesCents) : '—',
          a ? formatRand(a.principalCents + a.overpaymentCents) : '—',
          a ? formatRand(a.balanceAfterCents) : '—',
        ];
      });
      const liveAdjustments = loan.adjustments.filter((a) => !a.reversedAt);
      for (const a of liveAdjustments) {
        rows.push([formatDate(fromDbDate(a.effectiveDate)), a.kind.replace(/_/g, ' ').toLowerCase(), 'Adjustment', formatRand(a.amountCents), '', '', '', '']);
      }
      rows.sort((x, y) => x[0].split('/').reverse().join('').localeCompare(y[0].split('/').reverse().join('')));
      if (rows.length) {
        this.table(
          doc,
          [
            { label: 'Date', width: 55 },
            { label: 'Transaction', width: 110 },
            { label: 'Method', width: 55 },
            { label: 'Amount', width: 60, align: 'right' },
            { label: 'Interest', width: 52, align: 'right' },
            { label: 'Fees', width: 48, align: 'right' },
            { label: 'Principal', width: 55, align: 'right' },
            { label: 'Balance', width: 60, align: 'right' },
          ],
          rows,
        );
      } else {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No payments recorded yet.');
      }

      this.section(doc, 'Repayment schedule');
      this.table(
        doc,
        [
          { label: '#', width: 30 },
          { label: 'Due date', width: 70 },
          { label: 'Amount due', width: 85, align: 'right' },
          { label: 'Paid', width: 85, align: 'right' },
          { label: 'Remaining', width: 85, align: 'right' },
          { label: 'Status', width: 140 },
        ],
        loan.instalments.map((i) => [
          String(i.seq) + (i.version > 1 ? ` (v${i.version})` : ''),
          formatDate(fromDbDate(i.dueDate)),
          formatRand(i.supersededOn ? i.amountCents : i.amountDueCents),
          formatRand(i.paidCents),
          formatRand(i.remainingCents),
          i.status === 'RESCHEDULED' ? 'Replaced by arrangement' : i.status.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
        ]),
      );
    });
    return { fileName: `Statement-${loan.reference}-${todaySast()}.pdf`, pdf };
  }

  async settlementLetter(loanId: string): Promise<{ fileName: string; pdf: Buffer }> {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, include: { client: true } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.status !== 'SETTLED' || !loan.settledOn) throw new NotFoundException('This loan has not been settled');
    const settledOn = loan.settledOn;
    const s = await this.settings.get();
    const pdf = await this.render(async (doc) => {
      await this.header(doc, 'Settlement confirmation', `${loan.reference}  ·  Issued ${formatDate(todaySast())}`);
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10.5).fillColor(INK);
      doc.text(`Dear ${loan.client.firstName} ${loan.client.lastName},`);
      doc.moveDown();
      doc.text(
        `We confirm that loan ${loan.reference} (${PRODUCT_LABEL[loan.product].toLowerCase()}, disbursed on ${formatDate(fromDbDate(loan.disbursedOn))}) ` +
          `was paid in full on ${formatDate(fromDbDate(settledOn))}. No further amount is owed on this loan and no further repayments will be collected.`,
        { align: 'justify', lineGap: 2 },
      );
      doc.moveDown();
      this.kv(doc, [
        ['Client', `${loan.client.firstName} ${loan.client.lastName}`],
        ['ID number', loan.client.idNumber],
        ['Loan reference', loan.reference],
        ['Loan amount', formatRand(loan.loanAmountCents)],
        ['Total repaid', formatRand(loan.totalPaidCents - loan.overpaymentCents)],
        ['Settlement date', formatDate(fromDbDate(settledOn))],
        ['Outstanding balance', formatRand(0)],
      ]);
      if (loan.overpaymentCents > 0) {
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(`An overpayment of ${formatRand(loan.overpaymentCents)} is held in your favour and will be refunded.`);
      }
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text('Thank you for choosing us.');
      doc.moveDown(2);
      doc.text('Yours sincerely,');
      doc.moveDown(2.5);
      doc.font('Helvetica-Bold').text(s.companyName);
      doc.font('Helvetica-Oblique').fillColor(GOLD).text(s.tagline);
    });
    return { fileName: `Settlement-${loan.reference}.pdf`, pdf };
  }
}
