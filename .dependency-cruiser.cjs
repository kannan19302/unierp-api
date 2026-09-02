/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      comment: 'Circular dependencies make module extraction and boot ordering unsafe.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-cross-module-deep-imports',
      severity: 'error',
      comment: 'Direct deep imports between different NestJS modules are forbidden. Use common interfaces or event boundaries.',
      from: {
        path: '^src/modules/([^/]+)',
        pathNot: '(^src/modules/ecommerce/|^src/modules/outbox/|^src/modules/saas-portal/|^src/modules/admin/|\\.spec\\.ts$|/tests/)'
      },
      to: {
        path: '^src/modules/([^/]+)',
        pathNot: '(^src/modules/$1|^src/modules/outbox/)'
      }
    },
    {
      name: 'no-direct-prisma-in-controllers',
      severity: 'warn',
      comment: 'Controllers must never import Prisma or database directly.',
      from: {
        path: '\\.controller\\.ts$',
        pathNot: '(\\.spec\\.ts$|/tests/)'
      },
      to: {
        path: '@kannan19302/database'
      }
    },
    {
      name: 'no-direct-prisma-in-services',
      severity: 'warn',
      comment: 'Services should access persistence via dedicated Domain Repositories (*.repository.ts).',
      from: {
        path: '\\.service\\.ts$',
        pathNot: '(\\.spec\\.ts$|/tests/)'
      },
      to: {
        path: '@kannan19302/database'
      }
    },
    {
      name: 'no-legacy-developer-root-imports',
      severity: 'error',
      comment: 'The developer module has been consolidated into src/modules/developer/. Legacy root imports are forbidden.',
      from: {},
      to: {
        path: '^src/developer/'
      }
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
