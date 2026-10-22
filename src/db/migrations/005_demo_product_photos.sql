-- The demo products get photographs in place of their line drawings. Only rows still on a demo drawing change.
UPDATE product_images
   SET url = '/static/img/products/' || substring(url FROM '^/static/img/demo-([a-z]+)\.svg$') || '.jpg'
 WHERE url ~ '^/static/img/demo-(perfume|oud|candle|bag|wallet|gift)\.svg$';
