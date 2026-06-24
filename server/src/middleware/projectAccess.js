const prisma = require('../config/database');

function projectAccess(minRole = 'member') {
  const roleRank = { member: 0, admin: 1, owner: 2 };

  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId || req.params.id;
      const userId = req.user.id;

      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });

      if (!member) {
        return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
      }

      if (roleRank[member.role] < roleRank[minRole]) {
        return res.status(403).json({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }

      req.projectMember = member;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = projectAccess;
