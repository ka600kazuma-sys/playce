import "server-only";
import { signFormToken } from "@/lib/domain/abuse";

// 申込フォーム用の署名トークン。本番で FORM_SECRET が無ければ空(= 申込を受け付けない)。
export const formSecret = () => process.env.FORM_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-only-form-secret");
export const newFormToken = () => {
  const secret = formSecret();
  return secret ? signFormToken(secret, Date.now()) : "";
};
