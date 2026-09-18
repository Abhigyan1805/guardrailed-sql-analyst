-- 001_schema.sql — 7-table shop schema (PG16 + PGlite compatible)
CREATE TABLE IF NOT EXISTS categories (
  category_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT,
  region TEXT NOT NULL CHECK (region IN ('NA','EU','APAC')),
  segment TEXT NOT NULL CHECK (segment IN ('consumer','corp','vip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  product_id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INT NOT NULL REFERENCES categories(category_id),
  list_price NUMERIC(10,2) NOT NULL,
  cost NUMERIC(10,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  stock_qty INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  order_id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled','refunded')),
  ordered_at TIMESTAMPTZ NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('NA','EU','APAC')),
  sales_rep_id INT NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_a'
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(product_id),
  qty INT NOT NULL CHECK (qty >= 0),
  unit_price NUMERIC(10,2) NOT NULL,
  discount NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount < 1),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(order_id),
  method TEXT NOT NULL CHECK (method IN ('card','paypal','wire')),
  amount NUMERIC(10,2) NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(product_id),
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders(ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_region ON orders(region);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_customers_region ON customers(region);
