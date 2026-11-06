import arcjet, { shield, detectBot, slidingWindow } from "@arcjet/node";

const isProduction = process.env.NODE_ENV === "production";

if (!process.env.ARCJET_KEY && isProduction) {
  throw new Error("ARCJET_KEY is not set in the environment variables");
}

const arcjetKey = process.env.ARCJET_KEY;

const aj = !arcjetKey ? null : arcjet({
  key: arcjetKey,
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE",
      allow: [
        "CATEGORY:SEARCH_ENGINE",
      ],
    }),
    // slidingWindow({
    //   mode: "LIVE",
    //   interval: '2m',
    //   max: 5,
    // }),
  ],
});

export const deviceAj = !arcjetKey ? null : arcjet({
  key: arcjetKey,
  rules: [shield({ mode: "LIVE" })],
});

export default aj;