# Catalogue thumbnail bounds recovery

Public acceptance of the first-fifty Velo change exposed a regression from `8dda9304`: the new `height="168"` HTML attribute made a list image 168 px tall inside a 60 px mobile thumbnail grid. The container clipped the image. A completed image download and natural size of 168 px did not prove correct rendering; the prior tests missed its actual rendered box.

Recovery removes only the newly added width/height attribute interpolation from `imageMarkup`, restoring the previously working CSS sizing. Lazy loading, the bounded 168 px CDN file, async decoding, original large images and all other code remain. The 50-product Velo read is unchanged at `32602376`.

Isolated Chrome reproduces the old 60 x 168 px image in a 60 x 60 px mobile box and the restored 60 x 60 px image after removing the attributes. Image assertions now reject that fixed HTML size. Browser bounds verification covers 320, 390 and desktop widths. No Pages permission change or release is implied by preparing this recovery.
