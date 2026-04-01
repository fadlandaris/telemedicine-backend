import { Body, Controller, Post, Req, Res, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import type { Request, Response } from "express";
import { JwtGuard } from "./guards/jwt.guard";

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];

    const result = await this.auth.login({
      email: dto.email,
      password: dto.password,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    // Refresh token via HttpOnly Cookie (recommended)
    res.cookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // true kalau https
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return {
      accessToken: result.accessToken,
      doctor: result.doctor,
    };
  }

  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];
    const rt = (req.cookies?.["refresh_token"] as string | undefined) || "";

    const result = await this.auth.refresh({
      refreshToken: rt,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    res.cookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return { accessToken: result.accessToken, doctor: result.doctor };
  }

  @UseGuards(JwtGuard)
  @Post("logout")
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];
    const rt = (req.cookies?.["refresh_token"] as string | undefined) || undefined;

    await this.auth.logout({
      refreshToken: rt,
      doctorId: req.user?.id,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    res.clearCookie("refresh_token", { path: "/" });
    return { ok: true };
  }

  @UseGuards(JwtGuard)
  @Post("logout-all")
  async logoutAll(@Req() req: any) {
    await this.auth.logout({
      revokeAll: true,
      doctorId: req.user.id,
    });
    return { ok: true };
  }
}
