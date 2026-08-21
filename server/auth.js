import jwt from "jsonwebtoken";

const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");

export function createToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, secret, { expiresIn: "8h", issuer: "sowmy-kitchen" });
}

export function requireAuth(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required." });
    try {
      const user = jwt.verify(token, secret, { issuer: "sowmy-kitchen" });
      if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: "You do not have permission for this action." });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: "Your session is invalid or expired." });
    }
  };
}
