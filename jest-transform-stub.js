// This is a dummy transformer that just returns the source code
module.exports = {
  process(src) {
    return { code: src };
  },
};