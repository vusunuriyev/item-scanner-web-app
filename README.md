# Open Lot

Point your phone at an object. The site names it, then asks:

**Hey, this is the item. What do you want to do with it?**

Sell it on a marketplace, see what it recently sold for, learn more, or save it to a private lot on your phone.

## Live site (iPhone)

Open this HTTPS page on your iPhone. Safari will only allow the camera on a secure site:

**https://vusunuriyev.github.io/item-scanner-web-app/**

1. Tap **Open the camera** and allow camera access.
2. Frame the object and tap the shutter.
3. Choose **Sell it** to jump to eBay, Facebook Marketplace, Mercari, OfferUp, or Craigslist.

First load downloads a free in-browser model (a few megabytes). After that it is much snappier.

## Free APIs used (no paid keys)

- Object names: TensorFlow.js COCO-SSD from jsDelivr  
  `https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3`
- Short descriptions: Wikipedia REST API  
  `https://en.wikipedia.org/api/rest_v1/page/summary/{item}`

Photos stay on your device. Wikipedia is only asked for a summary after a scan. Marketplaces open in a new tab when you choose them.

## Local preview

If you want to run it on your computer:

```bash
npx --yes serve -p 4173
```

Then open `http://localhost:4173`. Camera access on a real iPhone still needs the live HTTPS URL above.
