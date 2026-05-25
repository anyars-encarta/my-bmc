import arcjet, { shield, detectBot, slidingWindow } from "@arcjet/node";

if(!process.env.ARCJET_KEY && process.env.NODE_ENV !== "test") {
  throw new Error("ARCJET_KEY is not set in the environment variables");
};

const aj = process.env.NODE_ENV === "test" ? null : arcjet({
  key: process.env.ARCJET_KEY!,
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

export default aj;