const fs = require('fs');
const path = require('path');
const glob = require('glob');

function findExports(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const exports = [];
    const regex = /export\s+(?:type\s+)?(?:interface|enum|const|class|function)\s+([A-Za-z0-9_]+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        exports.push(match[1]);
    }
    return exports;
}

const modulesDir = path.join(__dirname, 'src', 'modules');
const localExportMap = new Map(); // exportName -> absolute path to 'shared' folder

const modules = fs.readdirSync(modulesDir);
for (const mod of modules) {
    const modPath = path.join(modulesDir, mod);
    if (!fs.statSync(modPath).isDirectory()) continue;
    
    const sharedDir = path.join(modPath, 'shared');
    if (fs.existsSync(sharedDir)) {
        const sharedFiles = glob.sync(sharedDir.replace(/\\/g, '/') + '/**/*.ts');
        for (const file of sharedFiles) {
            const exports = findExports(file);
            for (const e of exports) {
                localExportMap.set(e, sharedDir);
            }
        }
    }
}

// Now replace imports in ALL files
const allTsFiles = glob.sync(modulesDir.replace(/\\/g, '/') + '/**/*.ts');
for (const file of allTsFiles) {
    // Don't modify shared files themselves
    if (file.replace(/\\/g, '/').includes('/shared/')) continue;
    
    let content = fs.readFileSync(file, 'utf-8');
    let modified = false;
    
    const importRegex = /import\s+(?:type\s+)?({[^}]+})\s+from\s+['"]@kannan19302\/shared['"]/g;
    let match;
    const replacements = [];
    
    while ((match = importRegex.exec(content)) !== null) {
        const importBlock = match[1];
        const imports = importBlock.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean);
        
        const toKeep = [];
        const toLocal = new Map(); // sharedDir -> array of imports
        
        for (const imp of imports) {
            const name = imp.split(' as ')[0].trim();
            if (localExportMap.has(name)) {
                const targetSharedDir = localExportMap.get(name);
                if (!toLocal.has(targetSharedDir)) toLocal.set(targetSharedDir, []);
                toLocal.get(targetSharedDir).push(imp);
            } else {
                toKeep.push(imp);
            }
        }
        
        if (toLocal.size > 0) {
            modified = true;
            const newLines = [];
            if (toKeep.length > 0) {
                newLines.push(`import { ${toKeep.join(', ')} } from '@kannan19302/shared';`);
            }
            
            for (const [targetSharedDir, localImports] of toLocal.entries()) {
                const fileDir = path.dirname(file);
                let relPath = path.relative(fileDir, targetSharedDir).replace(/\\/g, '/');
                if (!relPath.startsWith('.')) {
                    relPath = './' + relPath;
                }
                newLines.push(`import { ${localImports.join(', ')} } from '${relPath}';`);
            }
            
            replacements.push({
                start: match.index,
                end: match.index + match[0].length,
                text: newLines.join('\n')
            });
        }
    }
    
    if (modified) {
        replacements.sort((a, b) => b.start - a.start);
        for (const rep of replacements) {
            content = content.substring(0, rep.start) + rep.text + content.substring(rep.end);
        }
        fs.writeFileSync(file, content);
        console.log(`Updated ${file}`);
    }
}
