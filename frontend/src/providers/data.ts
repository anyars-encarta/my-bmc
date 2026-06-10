import { createSimpleRestDataProvider } from "@refinedev/rest/simple-rest";
import { API_URL } from "@/constants/app";

export const { dataProvider, kyInstance } = createSimpleRestDataProvider({
  apiURL: API_URL,
  kyOptions: {
    credentials: "include",
  },
});
