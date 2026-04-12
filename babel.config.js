module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // WatermelonDB decorators support (@field, @date, etc.)
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      //['@babel/plugin-transform-class-properties', { loose: true }],
      // Path aliases (@screens/..., @api/...)
      [
        'module-resolver',
        {
          root: ['./src'],
          extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
          alias: {
            '@api':        './src/api',
            '@components': './src/components',
            '@context':    './src/context',
            '@db':         './src/db',
            '@hooks':      './src/hooks',
            '@navigation': './src/navigation',
            '@screens':    './src/screens',
            '@types':      './src/types',
            '@utils':      './src/utils',
          },
        },
      ],
    ],
  };
};
