import type { BrowserTicketResponse, CollaborationNode } from "@vibe-git/protocol";
import type { V20Repository } from "./repository.js";
import { forbidden } from "../domain/errors.js";
import { hashSecret, newSecret } from "./runtime-secrets.js";
const now = () => new Date().toISOString();

export class SessionService {
  constructor(private readonly repo: V20Repository) {}
  authenticateBearer(header: string | undefined): CollaborationNode {
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw forbidden("缺少节点凭据");
    const node = this.repo.getNodeByCredentialHash(hashSecret(match[1]));
    if (!node || node.revoked) throw forbidden("节点凭据无效或已撤销");
    return node;
  }

  authenticateSession(rawCookie: string | undefined): CollaborationNode {
    const session = rawCookie?.split(";").map((item) => item.trim()).find((item) => item.startsWith("vibe_session="))?.slice("vibe_session=".length);
    if (!session) throw forbidden("请先运行 vibe-git open 建立浏览器会话");
    const nodeId = this.repo.nodeIdForBrowserSession(hashSecret(decodeURIComponent(session)), now());
    const node = nodeId ? this.repo.getNode(nodeId) : undefined;
    if (!node || node.revoked) throw forbidden("浏览器会话已失效，请重新运行 vibe-git open");
    return node;
  }

  createBrowserTicket(node: CollaborationNode, publicBase: string): BrowserTicketResponse {
    const raw = newSecret();
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString();
    this.repo.putBrowserTicket(hashSecret(raw), node.id, expiresAt);
    return { url: `${publicBase.replace(/\/$/, "")}/session/${raw}`, expiresAt };
  }

  exchangeBrowserTicket(raw: string): { session: string; nodeId: string } {
    const nodeId = this.repo.consumeBrowserTicket(hashSecret(raw), now());
    if (!nodeId) throw forbidden("浏览器票据无效、已使用或已过期");
    const session = newSecret();
    this.repo.putBrowserSession(hashSecret(session), nodeId, new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString());
    return { session, nodeId };
  }

}
