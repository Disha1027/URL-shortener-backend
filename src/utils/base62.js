const characters = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function encodeBase62(number) {
  if (number === 0) {
    return "0";
  }

  let result = "";

  while (number > 0) {
    const remainder = number % 62;
    result = characters[remainder] + result;
    number = Math.floor(number / 62);
  }

  return result;
}

module.exports = encodeBase62;