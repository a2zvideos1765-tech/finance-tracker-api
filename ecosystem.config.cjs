module.exports = {
  apps: [
    {
      name: 'finance-tracker-api',
      script: 'server.js',
      cwd: '/home/user/finance-tracker-api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3500
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/home/user/finance-tracker-api/logs/pm2-error.log',
      out_file: '/home/user/finance-tracker-api/logs/pm2-out.log',
      merge_logs: true
    }
  ]
};
