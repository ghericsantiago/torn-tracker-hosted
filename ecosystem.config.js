module.exports = {
  apps: [
    {
      name:   'torn-tracker',
      script: 'server.js',
      env:    { NODE_ENV: 'production' },
    },
    {
      name:   'portfolio-sync',
      script: 'portfolio-worker.js',
      env:    { NODE_ENV: 'production' },
    },
  ],
};
