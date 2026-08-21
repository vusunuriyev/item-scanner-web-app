# Open Lot

Point your phone at an object. The site names it, then asks:

**Hey, this is the item. What do you want to do with it?**

## Live site (iPhone)

Open this in **Safari** (camera needs HTTPS):

**https://vusunuriyev.github.io/item-scanner-web-app/**

1. Wait until the button says **Open the camera** (first visit downloads a free vision model).
2. Allow the camera, fill the frame with the object, tap the shutter.
3. You always get an answer — including windows and doors.
4. Tap **Turn the camera on again** to scan the next thing.

If the camera was previously blocked: iPhone **Settings → Safari → Camera → Allow**, then reload.

## Free models (no paid keys)

- Object names: CLIP via Transformers.js  
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2`  
  model: `Xenova/clip-vit-base-patch32`
- Descriptions: Wikipedia REST API  
  `https://en.wikipedia.org/api/rest_v1/page/summary/{item}`

Photos stay on your device unless you open a marketplace yourself.

## Local preview

```bash
npx --yes serve -p 4173
```
