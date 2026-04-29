// TEC-8 Assembler
// Register encoding: R0=00, R1=01, R2=10, R3=11
const REG = { R0: 0b00, R1: 0b01, R2: 0b10, R3: 0b11 };

function parseReg(s) {
  const u = s.trim().toUpperCase();
  if (u in REG) return REG[u];
  return null;
}

// First pass: collect labels and their addresses
export function assemble(source) {
  const lines = source.split('\n');
  const labels = {};
  const parsed = []; // { lineIdx, type, tokens, comment, raw }

  // Strip comments and parse labels
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    let line = raw;
    const semiIdx = line.indexOf(';');
    const comment = semiIdx >= 0 ? line.slice(semiIdx) : '';
    if (semiIdx >= 0) line = line.slice(0, semiIdx);
    line = line.trim();

    if (!line) {
      parsed.push({ lineIdx: i, type: 'empty', comment, raw });
      continue;
    }

    // Label
    if (line.endsWith(':')) {
      const lbl = line.slice(0, -1).trim().toUpperCase();
      parsed.push({ lineIdx: i, type: 'label', label: lbl, comment, raw });
      continue;
    }

    // Label before instruction e.g. "LOOP: ADD R0, R1"
    const colonIdx = line.indexOf(':');
    let instrPart = line;
    if (colonIdx > 0) {
      const lbl = line.slice(0, colonIdx).trim().toUpperCase();
      instrPart = line.slice(colonIdx + 1).trim();
      parsed.push({ lineIdx: i, type: 'label_inline', label: lbl, instrPart, comment, raw });
    } else {
      parsed.push({ lineIdx: i, type: 'instr', instrPart: line, comment, raw });
    }
  }

  // Assign addresses (labels map to next instruction address)
  let addr = 0;
  const addrMap = []; // addrMap[parsedIdx] = address or null
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (p.type === 'empty') { addrMap.push(null); continue; }
    if (p.type === 'label') {
      labels[p.label] = addr;
      addrMap.push(null);
      continue;
    }
    if (p.type === 'label_inline') {
      labels[p.label] = addr;
      addrMap.push(addr);
      addr++;
      continue;
    }
    addrMap.push(addr);
    addr++;
  }

  // Second pass: encode instructions
  const results = [];

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    const baseResult = { lineIdx: p.lineIdx, address: null, byte: null, error: null };

    if (p.type === 'empty' || p.type === 'label') {
      results.push({ ...baseResult });
      continue;
    }

    const iAddr = addrMap[i];
    baseResult.address = iAddr;

    const instrPart = p.instrPart.trim();
    const spaceIdx = instrPart.search(/\s/);
    const mnem = (spaceIdx >= 0 ? instrPart.slice(0, spaceIdx) : instrPart).toUpperCase();
    const args = spaceIdx >= 0 ? instrPart.slice(spaceIdx + 1).trim() : '';

    let byte = null;
    let error = null;

    try {
      switch (mnem) {
        case 'NOP':
          byte = 0b00000000; break;
        case 'ADD': {
          const [rd, rs] = args.split(',').map(s => s.trim());
          const rdv = parseReg(rd), rsv = parseReg(rs);
          if (rdv === null) error = `无效寄存器: ${rd}`;
          else if (rsv === null) error = `无效寄存器: ${rs}`;
          else byte = (0b0001 << 4) | (rdv << 2) | rsv;
          break;
        }
        case 'SUB': {
          const [rd, rs] = args.split(',').map(s => s.trim());
          const rdv = parseReg(rd), rsv = parseReg(rs);
          if (rdv === null) error = `无效寄存器: ${rd}`;
          else if (rsv === null) error = `无效寄存器: ${rs}`;
          else byte = (0b0010 << 4) | (rdv << 2) | rsv;
          break;
        }
        case 'AND': {
          const [rd, rs] = args.split(',').map(s => s.trim());
          const rdv = parseReg(rd), rsv = parseReg(rs);
          if (rdv === null) error = `无效寄存器: ${rd}`;
          else if (rsv === null) error = `无效寄存器: ${rs}`;
          else byte = (0b0011 << 4) | (rdv << 2) | rsv;
          break;
        }
        case 'INC': {
          const rdv = parseReg(args);
          if (rdv === null) error = `无效寄存器: ${args}`;
          else byte = (0b0100 << 4) | (rdv << 2);
          break;
        }
        case 'LD': {
          // LD Rd, [Rs]
          const m = args.match(/^(\w+)\s*,\s*\[(\w+)\]$/);
          if (!m) { error = '语法错误，应为 LD Rd, [Rs]'; break; }
          const rdv = parseReg(m[1]), rsv = parseReg(m[2]);
          if (rdv === null) error = `无效寄存器: ${m[1]}`;
          else if (rsv === null) error = `无效寄存器: ${m[2]}`;
          else byte = (0b0101 << 4) | (rdv << 2) | rsv;
          break;
        }
        case 'ST': {
          // ST Rs, [Rd]
          const m = args.match(/^(\w+)\s*,\s*\[(\w+)\]$/);
          if (!m) { error = '语法错误，应为 ST Rs, [Rd]'; break; }
          const rsv = parseReg(m[1]), rdv = parseReg(m[2]);
          if (rsv === null) error = `无效寄存器: ${m[1]}`;
          else if (rdv === null) error = `无效寄存器: ${m[2]}`;
          else byte = (0b0110 << 4) | (rdv << 2) | rsv;
          break;
        }
        case 'JC': {
          const target = resolveTarget(args, labels);
          if (target === null) { error = `未定义标签或非法数字: ${args}`; break; }
          // offset = target - @ where @ = address of JC instruction (PC <- @ + offset)
          const offset = target - iAddr;
          if (offset < -8 || offset > 7) { error = `跳转偏移超出4位有符号范围 [-8,7]: ${offset}`; break; }
          byte = (0b0111 << 4) | (offset & 0xF);
          break;
        }
        case 'JZ': {
          const target = resolveTarget(args, labels);
          if (target === null) { error = `未定义标签或非法数字: ${args}`; break; }
          const offset = target - iAddr;
          if (offset < -8 || offset > 7) { error = `跳转偏移超出4位有符号范围 [-8,7]: ${offset}`; break; }
          byte = (0b1000 << 4) | (offset & 0xF);
          break;
        }
        case 'JMP': {
          // JMP [Rd]
          const m = args.match(/^\[(\w+)\]$/);
          if (!m) { error = '语法错误，应为 JMP [Rd]'; break; }
          const rdv = parseReg(m[1]);
          if (rdv === null) error = `无效寄存器: ${m[1]}`;
          else byte = (0b1001 << 4) | (rdv << 2);
          break;
        }
        case 'OUT': {
          const rsv = parseReg(args);
          if (rsv === null) error = `无效寄存器: ${args}`;
          else byte = (0b1010 << 4) | rsv;
          break;
        }
        case 'IRET': byte = 0b10110000; break;
        case 'DI':   byte = 0b11000000; break;
        case 'EI':   byte = 0b11010000; break;
        case 'STOP': byte = 0b11100000; break;
        default:
          error = `未知指令: ${mnem}`;
      }
    } catch (e) {
      error = `解析错误: ${e.message}`;
    }

    results.push({ ...baseResult, byte, error });
  }

  return results;
}

function resolveTarget(args, labels) {
  const s = args.trim();
  const u = s.toUpperCase();
  if (u in labels) return labels[u];
  // Hex: e.g. 0FH, FFH, 3AH  (H suffix, case-insensitive)
  if (/^[0-9A-Fa-f]+H$/i.test(s)) return parseInt(s.slice(0, -1), 16);
  // Binary: e.g. 1010B, 0B  (B suffix, case-insensitive, only 0/1 digits)
  if (/^[01]+B$/i.test(s)) return parseInt(s.slice(0, -1), 2);
  // Strict decimal: reject "1abc" etc.
  if (/^-?\d+$/.test(s)) return Number(s);
  return null;
}
