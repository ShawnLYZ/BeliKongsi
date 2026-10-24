import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Renders ten fictional supplier invoices to 1,200 x 1,600 PNGs for the invoice-photo accuracy run, with
 * matching expectations in the text fixtures' format (without `text`). Every business and phone number is
 * made up. Expectations come from the catalogue (what each item named is), not from any model's answer.
 * Run: pnpm tsx scripts/make-invoice-fixtures.ts
 */

const OUT_DIR = join('tests', 'fixtures', 'ai-accuracy', 'invoices');

interface Item {
  /** Item as the invoice names it (mixed Malay, Chinese, English). */
  name: string;
  quantity: number;
  /** Unit as the invoice writes it. */
  unit: string;
  /** Unit price in sen. */
  priceSen: number;
  productKey: string;
}

interface Invoice {
  supplier: string;
  address: string;
  phone: string;
  invoiceNo: string;
  date: string;
  billTo: string;
  items: Item[];
  /** Degrees of CSS rotation (a slightly crooked photo). */
  rotate?: number;
  lowContrast?: boolean;
}

const INVOICES: Invoice[] = [
  {
    supplier: 'Kedai Runcit Maju Contoh',
    address: 'Lot 12, Jalan Perdana, 47100 Puchong',
    phone: '012-555 0101',
    invoiceNo: 'INV-2026-0141',
    date: '03/10/2026',
    billTo: 'Kopitiam Sedap Contoh',
    items: [
      {
        name: 'Susu Pekat Manis 390g',
        quantity: 5,
        unit: 'ctn',
        priceSen: 16800,
        productKey: 'CM',
      },
      { name: 'Minyak Masak 17kg', quantity: 3, unit: 'tin', priceSen: 11500, productKey: 'OIL' },
      {
        name: 'Tepung Gandum 25kg',
        quantity: 2,
        unit: 'guni',
        priceSen: 6800,
        productKey: 'FLOUR',
      },
    ],
  },
  {
    supplier: 'Sin Hup Trading Contoh',
    address: '88, Jalan Kenari 5, 47100 Puchong',
    phone: '016-555 0102',
    invoiceNo: 'SH-30418',
    date: '04/10/2026',
    billTo: 'Warung Pak Din Contoh',
    items: [
      { name: '炼奶 390g', quantity: 4, unit: '箱', priceSen: 16800, productKey: 'CM' },
      { name: '咖啡粉 1kg', quantity: 2, unit: '箱', priceSen: 26000, productKey: 'COFFEE' },
      {
        name: 'Teh (black tea dust) 1kg',
        quantity: 1,
        unit: 'carton',
        priceSen: 18000,
        productKey: 'TEA',
      },
      { name: '油 17kg', quantity: 2, unit: '桶', priceSen: 11500, productKey: 'OIL' },
    ],
  },
  {
    supplier: 'Borong Segar Contoh Sdn Bhd',
    address: 'No. 5, Jalan Industri 3, 43300 Seri Kembangan',
    phone: '019-555 0103',
    invoiceNo: 'BS/0092',
    date: '05/10/2026',
    billTo: 'Gerai Nasi Lemak Kak Yah Contoh',
    items: [
      {
        name: 'Susu Cair (Evap) 390g',
        quantity: 3,
        unit: 'karton',
        priceSen: 15000,
        productKey: 'EM',
      },
      {
        name: 'Beg Plastik (medium)',
        quantity: 2,
        unit: 'karton',
        priceSen: 8500,
        productKey: 'BAGS',
      },
      {
        name: 'Bekas Tapau 650ml',
        quantity: 1,
        unit: 'karton',
        priceSen: 9800,
        productKey: 'CONT',
      },
    ],
  },
  {
    supplier: 'Ah Seng Eggs & Dry Goods Contoh',
    address: '21, Jalan Pasar, 43000 Kajang',
    phone: '011-5550 0104',
    invoiceNo: 'AS-7714',
    date: '06/10/2026',
    billTo: 'Cafe Bunga Contoh',
    rotate: -1.8,
    items: [
      { name: 'Susu Cair 390g', quantity: 2, unit: 'ctn', priceSen: 15000, productKey: 'EM' },
      { name: 'Telur Gred B', quantity: 5, unit: 'tray', priceSen: 1260, productKey: 'EGG_B' },
      {
        name: 'Beg Kertas (Kraft)',
        quantity: 1,
        unit: 'ctn',
        priceSen: 12000,
        productKey: 'KRAFT',
      },
      {
        name: 'Cawan Plastik 16oz + lid',
        quantity: 3,
        unit: 'ctn',
        priceSen: 13500,
        productKey: 'CUPS',
      },
    ],
  },
  {
    supplier: 'Pasaraya Bahagia Contoh',
    address: '3A, Jalan Bunga Raya, 41000 Klang',
    phone: '013-555 0105',
    invoiceNo: 'PB-2210',
    date: '07/10/2026',
    billTo: 'Restoran Tiga Saudara Contoh',
    items: [
      { name: 'SKM (Susu Pekat)', quantity: 3, unit: 'ctn', priceSen: 16800, productKey: 'CM' },
      { name: 'Minyak Masak', quantity: 2, unit: 'tin', priceSen: 11500, productKey: 'OIL' },
      { name: 'Tepung', quantity: 1, unit: 'sack', priceSen: 6800, productKey: 'FLOUR' },
      { name: 'Serbuk Kopi 1kg', quantity: 1, unit: 'ctn', priceSen: 26000, productKey: 'COFFEE' },
      { name: 'Serbuk Teh 1kg', quantity: 2, unit: 'ctn', priceSen: 18000, productKey: 'TEA' },
    ],
  },
  {
    supplier: 'Lee Brothers Packaging Contoh',
    address: '9, Jalan Teknologi 2, 47810 Petaling Jaya',
    phone: '017-555 0106',
    invoiceNo: 'LB-5530',
    date: '08/10/2026',
    billTo: 'Kedai Kopi Hock Contoh',
    items: [
      { name: '饭盒 650ml', quantity: 2, unit: '箱', priceSen: 9800, productKey: 'CONT' },
      { name: '塑料袋 (medium)', quantity: 1, unit: '箱', priceSen: 8500, productKey: 'BAGS' },
      { name: 'Telur Gred A', quantity: 4, unit: 'dulang', priceSen: 1320, productKey: 'EGG_A' },
      { name: 'Evaporated Milk 390g', quantity: 2, unit: 'ctn', priceSen: 15000, productKey: 'EM' },
    ],
  },
  {
    supplier: 'Syarikat Mutiara Makmur Contoh',
    address: '17, Jalan Mawar, 40000 Shah Alam',
    phone: '012-555 0107',
    invoiceNo: 'MM-0418',
    date: '09/10/2026',
    billTo: 'Mamak Bistro Contoh',
    rotate: 2.2,
    items: [
      { name: 'Susu Pekat Manis', quantity: 4, unit: 'ctn', priceSen: 16800, productKey: 'CM' },
      { name: 'Cooking Oil 17kg', quantity: 2, unit: 'tin', priceSen: 11500, productKey: 'OIL' },
      { name: '鸡蛋 B', quantity: 6, unit: '盘', priceSen: 1260, productKey: 'EGG_B' },
      { name: 'Teh 1kg', quantity: 1, unit: 'ctn', priceSen: 18000, productKey: 'TEA' },
    ],
  },
  {
    supplier: 'Kilang Roti Seri Contoh',
    address: '45, Jalan Utama, 43200 Cheras',
    phone: '010-555 0108',
    invoiceNo: 'KR-1187',
    date: '10/10/2026',
    billTo: 'Bakeri Pagi Contoh',
    items: [
      { name: 'Tepung Gandum', quantity: 8, unit: 'guni', priceSen: 6800, productKey: 'FLOUR' },
      { name: 'Susu Pekat', quantity: 2, unit: 'ctn', priceSen: 16800, productKey: 'CM' },
      { name: 'Telur Gred A', quantity: 8, unit: 'tray', priceSen: 1320, productKey: 'EGG_A' },
      { name: 'Minyak', quantity: 4, unit: 'tin', priceSen: 11500, productKey: 'OIL' },
      { name: 'Susu Cair', quantity: 3, unit: 'ctn', priceSen: 15000, productKey: 'EM' },
      { name: 'Kopi 1kg', quantity: 1, unit: 'ctn', priceSen: 26000, productKey: 'COFFEE' },
    ],
  },
  {
    supplier: 'Wong & Sons Wholesale Contoh',
    address: '62, Jalan Pudu Lama, 55100 Kuala Lumpur',
    phone: '016-555 0109',
    invoiceNo: 'WS-3306',
    date: '11/10/2026',
    billTo: 'Bubble Tea Corner Contoh',
    lowContrast: true,
    items: [
      {
        name: 'Teh (Black Tea Dust) 1kg',
        quantity: 2,
        unit: 'ctn',
        priceSen: 18000,
        productKey: 'TEA',
      },
      { name: '咖啡粉 1kg', quantity: 3, unit: 'ctn', priceSen: 26000, productKey: 'COFFEE' },
      { name: 'Cawan 16oz', quantity: 2, unit: 'ctn', priceSen: 13500, productKey: 'CUPS' },
      { name: 'Beg Kertas', quantity: 1, unit: 'ctn', priceSen: 12000, productKey: 'KRAFT' },
    ],
  },
  {
    supplier: 'Gudang Barangan Jaya Contoh',
    address: '7, Jalan Gudang 1, 42000 Port Klang',
    phone: '019-555 0110',
    invoiceNo: 'GJ-8841',
    date: '12/10/2026',
    billTo: 'Dapur Mak Long Contoh',
    items: [
      { name: 'Susu Pekat 390g', quantity: 2, unit: 'ctn', priceSen: 16800, productKey: 'CM' },
      { name: 'Telur B', quantity: 5, unit: 'tray', priceSen: 1260, productKey: 'EGG_B' },
      { name: 'Susu Cair 淡奶', quantity: 3, unit: 'ctn', priceSen: 15000, productKey: 'EM' },
      { name: 'Minyak Masak', quantity: 1, unit: 'tin', priceSen: 11500, productKey: 'OIL' },
    ],
  },
];

const rm = (sen: number) =>
  (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function html(inv: Invoice): string {
  const ink = inv.lowContrast ? '#8f8f8f' : '#16181d';
  const paper = inv.lowContrast ? '#d9d6cc' : '#fbfaf5';
  const rule = inv.lowContrast ? '#bdbab0' : '#444';
  const total = inv.items.reduce((n, i) => n + i.quantity * i.priceSen, 0);
  const rows = inv.items
    .map(
      (i, n) => `<tr>
        <td class="c">${n + 1}</td><td>${i.name}</td><td class="r">${i.quantity} ${i.unit}</td>
        <td class="r">${rm(i.priceSen)}</td><td class="r">${rm(i.quantity * i.priceSen)}</td></tr>`,
    )
    .join('');
  const bg = inv.rotate || inv.lowContrast ? '#a9a59a' : '#fbfaf5';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1200px; height: 1600px; background: ${bg}; overflow: hidden;
      font-family: 'Segoe UI', 'Microsoft YaHei', 'Noto Sans CJK SC', Arial, sans-serif; color: ${ink}; }
    .page { position: absolute; left: 60px; top: 70px; width: 1080px; height: 1460px; padding: 70px 70px;
      background: ${paper}; transform: rotate(${inv.rotate ?? 0}deg); transform-origin: center;
      ${inv.rotate ? 'box-shadow: 0 6px 24px rgba(0,0,0,.35);' : ''} }
    h1 { margin: 0; font-size: 50px; letter-spacing: .5px; }
    .sub { font-size: 27px; margin-top: 8px; line-height: 1.45; }
    .bar { display: flex; justify-content: space-between; margin-top: 46px; padding-top: 22px;
      border-top: 4px solid ${rule}; font-size: 29px; line-height: 1.6; }
    .title { font-size: 40px; font-weight: 700; letter-spacing: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 44px; font-size: 31px; }
    th { text-align: left; padding: 14px 10px; border-top: 3px solid ${rule}; border-bottom: 3px solid ${rule}; font-size: 27px; }
    td { padding: 20px 10px; border-bottom: 1px solid ${rule}; }
    .r { text-align: right; } .c { text-align: center; width: 60px; }
    .total { margin-top: 36px; text-align: right; font-size: 38px; font-weight: 700; }
    .foot { position: absolute; left: 70px; bottom: 70px; font-size: 24px; }
  </style></head><body><div class="page">
    <h1>${inv.supplier.replace('&', '&amp;')}</h1>
    <div class="sub">${inv.address}<br>Tel: ${inv.phone}</div>
    <div class="bar"><div>Bill to:<br><b>${inv.billTo}</b></div>
      <div style="text-align:right"><span class="title">INVOICE</span><br>No: ${inv.invoiceNo}<br>Date: ${inv.date}</div></div>
    <table><thead><tr><th class="c">#</th><th>Item / 品名</th><th class="r">Qty</th><th class="r">Price (RM)</th><th class="r">Amount (RM)</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="total">Total: RM ${rm(total)}</div>
    <div class="foot">Terima kasih / 谢谢 - Goods sold are not returnable.</div>
  </div></body></html>`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    for (const [n, inv] of INVOICES.entries()) {
      const id = `invoice-${String(n + 1).padStart(2, '0')}`;
      await page.setContent(html(inv));
      await page.screenshot({ path: join(OUT_DIR, `${id}.png`), type: 'png' });
      const fixture = {
        id,
        expected: inv.items.map((i) => ({ productKey: i.productKey, quantity: i.quantity })),
      };
      await writeFile(join(OUT_DIR, `${id}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
      console.log(id);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'fixture generation failed.');
  process.exit(1);
});
