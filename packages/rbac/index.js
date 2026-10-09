export const roles = {
  super_admin: ["*"],
  admin: [
    "attendance.self",
    "attendance.configure",
    "board.view",
    "board.manage",
    "board.assign",
    "board.review",
    "directory.view",
    "hr.view",
    "hr.manage",
    "hr.approve",
    "users.manage",
    "feedback.view",
    "feedback.manage",
    "users.view",
    "audit.view",
    "sandbox.reset",
  ],
  it_admin: [
    "attendance.self",
    "directory.view",
    "users.view",
    "users.manage",
    "audit.view",
  ],
  hr_officer: ["attendance.self", "directory.view", "hr.view", "hr.manage"],
  chair: ["board.view", "board.assign", "board.review", "directory.view"],
  director: ["board.view", "directory.view"],
  manager: [
    "attendance.self",
    "directory.view",
    "hr.view",
    "hr.approve",
    "feedback.view",
    "feedback.manage",
  ],
  staff: [
    "attendance.self",
    "directory.view",
    "feedback.view",
    "feedback.manage",
  ],
  viewer: ["feedback.view"],
};
export function can(role, permission) {
  return Boolean(roles[role]?.some((p) => p === "*" || p === permission));
}
