import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtPayload } from "../types/jwt-payload";

export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as JwtPayload;
});
