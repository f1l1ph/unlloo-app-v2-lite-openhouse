import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const artifactsPath = join(__dirname, "../artifacts/contracts/Unlloo.sol/Unlloo.json");

  try {
    const artifact = JSON.parse(readFileSync(artifactsPath, "utf8"));
    const bytecode = artifact.bytecode;
    const size = (bytecode.length - 2) / 2; // Remove '0x' prefix, divide by 2 for bytes

    console.log(`\n📦 Contract Size Analysis:`);
    console.log(`   Bytecode size: ${size.toLocaleString()} bytes`);
    console.log(`   Limit: 24,576 bytes (24KB)`);
    console.log(`   Usage: ${((size / 24576) * 100).toFixed(2)}%`);

    if (size > 24576) {
      console.log(`   ⚠️  WARNING: Contract exceeds size limit!`);
      process.exit(1);
    } else if (size > 23000) {
      console.log(`   ⚠️  WARNING: Contract is close to size limit!`);
    } else {
      console.log(`   ✅ Contract size is safe`);
    }
  } catch {
    console.error("❌ Error reading contract artifact. Make sure to compile first:");
    console.error("   yarn hardhat:compile");
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
