-- The demo photographs move to WebP (a smaller file; the JPEGs stay for old links), and the delivery question reads in the store's dialect.
UPDATE product_images
   SET url = regexp_replace(url, '\.jpg$', '.webp')
 WHERE url ~ '^/static/img/products/(perfume|oud|candle|bag|wallet|gift)\.jpg$';
UPDATE products
   SET faq = replace(faq::text, 'كم مدة التوصيل؟', 'شكد يطول التوصيل؟')::jsonb
 WHERE faq::text LIKE '%كم مدة التوصيل؟%';
