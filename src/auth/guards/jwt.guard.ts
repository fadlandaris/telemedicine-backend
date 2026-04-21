import { AuthGuard } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";

@Injectable()
export class JwtGuard extends AuthGuard("jwt") {
  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw new UnauthorizedException("Token tidak valid atau sudah expired");
    }
    return user;
  }
}
