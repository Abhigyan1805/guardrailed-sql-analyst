// Builds the schema-linking context fed to the LLM (spec 4.2): only the 3-5
// selected analytics_* views, each with typed columns + one-line description,
// 3 PII-free sample rows from seeded data, and enumerated values for
// low-cardinality columns. The full catalog is never shown.
import { linkSchema, type LinkedSchema } from '../lib/schema-link';
import type { ColumnSpec, SchemaContext, ViewSpec } from './engines/engine';

export interface Queryable {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

interface ViewDef {
  name: string;
  description: string;
  orderBy: string;
  columns: ColumnSpec[];
  enumColumns: string[];
}

const c = (name: string, type: string, description: string): ColumnSpec => ({ name, type, description });

export const VIEW_REGISTRY: Record<string, ViewDef> = {
  analytics_orders: {
    name: 'analytics_orders',
    description: 'One row per order; use for order counts, status, region and time-window questions.',
    orderBy: 'order_id',
    enumColumns: ['status', 'region'],
    columns: [
      c('order_id', 'integer', 'primary key of the order'),
      c('customer_id', 'integer', 'customer who placed the order'),
      c('status', "text enum('pending','paid','shipped','cancelled','refunded')", 'order lifecycle status'),
      c('ordered_at', 'timestamptz (UTC)', 'when the order was placed'),
      c('region', "text enum('NA','EU','APAC')", 'sales region'),
      c('sales_rep_id', 'integer', 'internal sales rep id'),
      c('tenant_id', 'text', 'owning tenant (RLS-scoped)'),
    ],
  },
  analytics_customers_masked: {
    name: 'analytics_customers_masked',
    description: 'One row per customer with masked name; no raw PII exists in this view.',
    orderBy: 'customer_id',
    enumColumns: ['region', 'segment'],
    columns: [
      c('customer_id', 'integer', 'primary key of the customer'),
      c('display_name', 'text', 'masked display name (CUSTOMER-<id>)'),
      c('region', "text enum('NA','EU','APAC')", 'customer region'),
      c('segment', "text enum('consumer','corp','vip')", 'customer segment'),
      c('created_at', 'timestamptz (UTC)', 'when the customer account was created'),
    ],
  },
  analytics_products_public: {
    name: 'analytics_products_public',
    description: 'One row per product with public pricing; finance-only cost is not exposed.',
    orderBy: 'product_id',
    enumColumns: ['is_active', 'category_name'],
    columns: [
      c('product_id', 'integer', 'primary key of the product'),
      c('sku', 'text', 'stock keeping unit'),
      c('name', 'text', 'product name'),
      c('category_id', 'integer', 'category foreign key'),
      c('category_name', 'text', 'category display name'),
      c('list_price', 'numeric', 'current list price'),
      c('is_active', 'boolean', 'whether the product is active'),
      c('stock_qty', 'integer', 'units on hand'),
    ],
  },
  analytics_order_lines: {
    name: 'analytics_order_lines',
    description: 'One row per order line; pre-joined to product and category. Revenue lives here.',
    orderBy: 'order_id, product_id',
    enumColumns: ['status', 'region', 'category_name'],
    columns: [
      c('order_id', 'integer', 'order this line belongs to'),
      c('product_id', 'integer', 'product sold on this line'),
      c('sku', 'text', 'product sku'),
      c('product_name', 'text', 'product name'),
      c('category_name', 'text', 'product category name'),
      c('qty', 'integer', 'units sold'),
      c('unit_price', 'numeric', 'price per unit at sale time'),
      c('discount', 'numeric', 'fractional discount (0..1)'),
      c('line_revenue', 'numeric', 'qty * unit_price * (1 - discount); use SUM for revenue'),
      c('status', "text enum('pending','paid','shipped','cancelled','refunded')", 'order status'),
      c('ordered_at', 'timestamptz (UTC)', 'when the order was placed'),
      c('region', "text enum('NA','EU','APAC')", 'order region'),
      c('tenant_id', 'text', 'owning tenant (RLS-scoped)'),
    ],
  },
  analytics_payments: {
    name: 'analytics_payments',
    description: 'One row per payment, joined to its order.',
    orderBy: 'payment_id',
    enumColumns: ['method', 'region', 'status'],
    columns: [
      c('payment_id', 'integer', 'primary key of the payment'),
      c('order_id', 'integer', 'order the payment settles'),
      c('method', "text enum('card','paypal','wire')", 'payment method'),
      c('amount', 'numeric', 'payment amount'),
      c('paid_at', 'timestamptz (UTC)', 'when the payment was made'),
      c('region', "text enum('NA','EU','APAC')", 'order region'),
      c('tenant_id', 'text', 'owning tenant (RLS-scoped)'),
      c('status', 'text', 'order status'),
    ],
  },
  analytics_reviews: {
    name: 'analytics_reviews',
    description: 'One row per product review.',
    orderBy: 'review_id',
    enumColumns: ['rating'],
    columns: [
      c('review_id', 'integer', 'primary key of the review'),
      c('product_id', 'integer', 'reviewed product'),
      c('product_name', 'text', 'reviewed product name'),
      c('sku', 'text', 'product sku'),
      c('customer_id', 'integer', 'reviewing customer'),
      c('rating', 'integer 1..5', 'star rating'),
      c('created_at', 'timestamptz (UTC)', 'when the review was written'),
    ],
  },
};

const PADDING_VIEWS = ['analytics_order_lines', 'analytics_products_public', 'analytics_customers_masked'];
const MAX_VIEWS = 5;
const MIN_VIEWS = 3;
const MAX_ENUM_VALUES = 20;

const MAX_STR = 120;

function truncateSample(row: Record<string, unknown>, cols: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of cols) {
    const v = row[col];
    out[col] = typeof v === 'string' && v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…` : v;
  }
  return out;
}

// Extra keyword rules on top of the shared linker, so views the linker does
// not know about (reviews, payments) are still offered when the question needs
// them. Purely additive; the view count is still capped (spec 4.2).
const EXTRA_RULES: [RegExp, string][] = [
  [/review|rating|star/, 'analytics_reviews'],
  [/payment|paypal|wire|card|refund/, 'analytics_payments'],
  [/categor|product|sku|inventory|stock|price/, 'analytics_products_public'],
  [/customer|segment|buyer|churn|cohort/, 'analytics_customers_masked'],
  [/revenue|line|item|discount|margin/, 'analytics_order_lines'],
];

export function selectViews(question: string, linked: LinkedSchema): string[] {
  const set = new Set(linked.tables.filter((t) => VIEW_REGISTRY[t]));
  const q = question.toLowerCase();
  for (const [re, view] of EXTRA_RULES) {
    if (re.test(q)) set.add(view);
  }
  for (const pad of PADDING_VIEWS) {
    if (set.size >= MIN_VIEWS) break;
    set.add(pad);
  }
  return [...set].slice(0, MAX_VIEWS);
}

async function sampleRows(db: Queryable, def: ViewDef): Promise<Record<string, unknown>[]> {
  const cols = def.columns.map((x) => x.name).join(', ');
  const r = await db.query(`SELECT ${cols} FROM ${def.name} ORDER BY ${def.orderBy} LIMIT 3`);
  return r.rows.map((row) => truncateSample(row, def.columns.map((x) => x.name)));
}

async function enumsFor(db: Queryable, def: ViewDef): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const col of def.enumColumns) {
    try {
      const r = await db.query(`SELECT DISTINCT ${col}::text AS v FROM ${def.name} WHERE ${col} IS NOT NULL ORDER BY 1 LIMIT ${MAX_ENUM_VALUES + 1}`);
      const values = r.rows.map((x) => String(x.v));
      if (values.length <= MAX_ENUM_VALUES) out[col] = values;
    } catch {
      // A column that cannot be enumerated is simply omitted from the prompt.
    }
  }
  return out;
}

export async function buildSchemaContext(
  question: string,
  db: Queryable,
  cache?: Map<string, ViewSpec>,
): Promise<SchemaContext> {
  const linked = linkSchema(question);
  const tables = selectViews(question, linked);
  const specs: ViewSpec[] = [];
  for (const name of tables) {
    const def = VIEW_REGISTRY[name];
    if (!def) continue;
    if (cache?.has(name)) {
      specs.push(cache.get(name)!);
      continue;
    }
    const [sampleRows_, enums] = await Promise.all([sampleRows(db, def), enumsFor(db, def)]);
    const spec: ViewSpec = { name, description: def.description, columns: def.columns, sampleRows: sampleRows_, enums };
    cache?.set(name, spec);
    specs.push(spec);
  }
  return { tables, views: specs, hint: linked.hint };
}
