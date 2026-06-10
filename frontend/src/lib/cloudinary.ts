import { CLOUDINARY_CLOUD_NAME } from "@/constants/index";
import { Cloudinary } from "@cloudinary/url-gen";
import { dpr, format, quality } from "@cloudinary/url-gen/actions/delivery";
import { source } from "@cloudinary/url-gen/actions/overlay";
import { fill } from "@cloudinary/url-gen/actions/resize";
import { Position } from "@cloudinary/url-gen/qualifiers";
import { compass } from "@cloudinary/url-gen/qualifiers/gravity";
import { text } from "@cloudinary/url-gen/qualifiers/source";
import { TextStyle } from "@cloudinary/url-gen/qualifiers/textStyle";

const cld = new Cloudinary({
  cloud: {
    cloudName: CLOUDINARY_CLOUD_NAME,
  },
});

export const bannerPhoto = (bannerCldPubId: string, name: string) => {
  return cld
    .image(bannerCldPubId)
    .resize(fill())
    .delivery(format("auto"))
    .delivery(quality("auto"))
    .delivery(dpr("auto"))
    .overlay(
      source(
        text(name, new TextStyle("roboto", 100).fontWeight("bold")).textColor(
          "white",
        ),
      ).position(
        new Position()
          .gravity(compass("west"))
        //   .offsetY(0.2)
          .offsetX(0.02),
      ),
    );
};
