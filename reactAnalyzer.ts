import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

export interface ComponentData {
    id: string;
    filePath: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    items: ComponentItem[];
}

export interface ComponentItem {
    id: string;
    name: string;
    type: 'state' | 'setter' | 'prop' | 'prop-function' | 'function' | 'context-provider' | 'context-consumer';
    color: string;
    flowId: string;
}

export interface DataFlow {
    id: string;
    fromItem: string;
    toItem: string;
    type: string;
}

export interface ConflictData {
    id: string;
    description: string;
    items: string[];
}

export interface AnalysisResult {
    components: ComponentData[];
    flows: DataFlow[];
    conflicts: ConflictData[];
    debug: DebugInfo;
}

export interface DebugInfo {
    filesAnalyzed: string[];
    componentsFound: string[];
    parseErrors: string[];
    analysisLog: string[];
}

export class ReactAnalyzer {
    private debugInfo: DebugInfo = {
        filesAnalyzed: [],
        componentsFound: [],
        parseErrors: [],
        analysisLog: []
    };

    async analyzeReactProject(projectPath: string): Promise<AnalysisResult> {
        this.debugInfo = {
            filesAnalyzed: [],
            componentsFound: [],
            parseErrors: [],
            analysisLog: []
        };

        this.debugInfo.analysisLog.push(`Starting analysis of: ${projectPath}`);

        const reactFiles = await this.findReactFiles(projectPath);
        this.debugInfo.analysisLog.push(`Found ${reactFiles.length} React files`);
        
        const components: ComponentData[] = [];
        const componentMap = new Map<string, ComponentData>(); // componentName -> ComponentData

        for (const filePath of reactFiles) {
            this.debugInfo.filesAnalyzed.push(filePath);
            try {
                this.debugInfo.analysisLog.push(`Analyzing file: ${filePath}`);
                const fileComponents = await this.analyzeFile(filePath);
                components.push(...fileComponents);
                
                // Build component map for flow analysis
                fileComponents.forEach(comp => {
                    componentMap.set(comp.name, comp);
                });
                
                fileComponents.forEach(comp => {
                    this.debugInfo.componentsFound.push(`${comp.name} (${comp.items.length} items)`);
                });
            } catch (error) {
                const errorMsg = `Error analyzing ${filePath}: ${error}`;
                this.debugInfo.parseErrors.push(errorMsg);
                console.error(errorMsg);
            }
        }

        this.debugInfo.analysisLog.push(`Total components found: ${components.length}`);

        // Analyze JSX usage to find actual prop flows
        const flows = await this.analyzeJSXFlows(reactFiles, componentMap);
        this.debugInfo.analysisLog.push(`Generated ${flows.length} flows from JSX analysis`);

        // Detect conflicts
        const conflicts = this.detectConflicts(components, flows);

        return {
            components: this.layoutComponents(components),
            flows,
            conflicts,
            debug: this.debugInfo
        };
    }

    private async findReactFiles(projectPath: string): Promise<string[]> {
        const reactFiles: string[] = [];
        
        const scanDirectory = (dirPath: string) => {
            if (dirPath.includes('node_modules') || 
                dirPath.includes('.git') || 
                dirPath.includes('.next') || 
                dirPath.includes('media') || 
                dirPath.includes('out')) return;
            
            try {
                const items = fs.readdirSync(dirPath);
                
                for (const item of items) {
                    const fullPath = path.join(dirPath, item);
                    const stat = fs.statSync(fullPath);
                    
                    if (stat.isDirectory()) {
                        scanDirectory(fullPath);
                    } else if (/\.(jsx?|tsx?)$/.test(item)) {
                        reactFiles.push(fullPath);
                    }
                }
            } catch (error) {
                this.debugInfo.parseErrors.push(`Error reading directory ${dirPath}: ${error}`);
            }
        };

        if (fs.statSync(projectPath).isFile()) {
            reactFiles.push(projectPath);
        } else {
            scanDirectory(projectPath);
        }

        return reactFiles;
    }

    private async analyzeFile(filePath: string): Promise<ComponentData[]> {
        const code = fs.readFileSync(filePath, 'utf-8');
        const components: ComponentData[] = [];
        const importedComponents: Map<string, string> = new Map(); // componentName -> sourceFile

        this.debugInfo.analysisLog.push(`Reading file: ${path.basename(filePath)} (${code.length} chars)`);

        try {
            const ast = parse(code, {
                sourceType: 'module',
                plugins: [
                    'jsx',
                    'typescript',
                    'decorators-legacy',
                    'classProperties'
                ]
            });

            this.debugInfo.analysisLog.push(`Successfully parsed AST for ${path.basename(filePath)}`);

            // First pass: collect imports
            traverse(ast, {
                ImportDeclaration: (path) => {
                    const source = path.node.source.value;
                    path.node.specifiers.forEach(spec => {
                        if (t.isImportDefaultSpecifier(spec) || t.isImportSpecifier(spec)) {
                            const localName = spec.local.name;
                            // Resolve relative imports
                            if (source.startsWith('.')) {
                                const resolvedPath = this.resolveImportPath(filePath, source);
                                if (resolvedPath) {
                                    importedComponents.set(localName, resolvedPath);
                                    this.debugInfo.analysisLog.push(`  Import: ${localName} from ${source}`);
                                }
                            }
                        }
                    });
                }
            });

            // Second pass: analyze components and re-exports

            // Second pass: analyze components and re-exports
            traverse(ast, {
                // Check for re-exports: export { Component } from './Component'
                ExportNamedDeclaration: (path) => {
                    // Re-export case
                    if (path.node.source) {
                        const source = path.node.source.value;
                        this.debugInfo.analysisLog.push(`Found re-export from: ${source}`);
                        
                        if (source.startsWith('.')) {
                            const resolvedPath = this.resolveImportPath(filePath, source);
                            if (resolvedPath) {
                                path.node.specifiers.forEach(spec => {
                                    if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
                                        const exportedName = spec.exported.name;
                                        importedComponents.set(exportedName, resolvedPath);
                                        this.debugInfo.analysisLog.push(`  Re-export: ${exportedName} from ${source}`);
                                    }
                                });
                            }
                        }
                        return; // Don't process as a regular export
                    }
                    
                    // Regular export case
                    const declaration = path.node.declaration;
                    
                    if (t.isFunctionDeclaration(declaration) && declaration.id) {
                        const name = declaration.id.name;
                        if (!name) return;
                        
                        this.debugInfo.analysisLog.push(`Found exported function: ${name}`);
                        
                        if (this.isReactComponent(declaration, name)) {
                            this.debugInfo.analysisLog.push(`✓ ${name} identified as exported React component`);
                            const component = this.analyzeComponent(declaration, filePath, name as string);
                            if (component) components.push(component);
                        }
                    } else if (t.isVariableDeclaration(declaration)) {
                        declaration.declarations.forEach(declarator => {
                            if (t.isIdentifier(declarator.id)) {
                                const name = declarator.id.name;
                                if (!name) return;
                                
                                if (t.isArrowFunctionExpression(declarator.init) || 
                                    t.isFunctionExpression(declarator.init)) {
                                    
                                    this.debugInfo.analysisLog.push(`Found exported arrow/function: ${name}`);
                                    
                                    if (this.isReactComponent(declarator.init, name)) {
                                        this.debugInfo.analysisLog.push(`✓ ${name} identified as exported React component`);
                                        const component = this.analyzeComponent(declarator, filePath, name as string);
                                        if (component) components.push(component);
                                    }
                                }
                            }
                        });
                    }
                },

                ExportDefaultDeclaration: (path) => {
                    // Re-export default: export { default } from './Component'
                    // This is handled by ExportNamedDeclaration above
                    
                    const declaration = path.node.declaration;
                    
                    if (t.isFunctionDeclaration(declaration) && declaration.id) {
                        const name = declaration.id.name;
                        if (!name) return;
                        
                        this.debugInfo.analysisLog.push(`Found default exported function: ${name}`);
                        
                        if (this.isReactComponent(declaration, name)) {
                            this.debugInfo.analysisLog.push(`✓ ${name} identified as default exported React component`);
                            const component = this.analyzeComponent(declaration, filePath, name as string);
                            if (component) components.push(component);
                        }
                    } else if (t.isArrowFunctionExpression(declaration) || t.isFunctionExpression(declaration)) {
                        const name = 'DefaultExport';
                        this.debugInfo.analysisLog.push(`Found default exported arrow/function`);
                        
                        if (this.isReactComponent(declaration, name)) {
                            this.debugInfo.analysisLog.push(`✓ Default export identified as React component`);
                            const component = this.analyzeComponent(declaration, filePath, name as string);
                            if (component) components.push(component);
                        }
                    } else if (t.isIdentifier(declaration)) {
                        this.debugInfo.analysisLog.push(`Found default export of identifier: ${declaration.name}`);
                        // We'll catch this as a regular declaration
                    }
                },

                // Function components (function declarations)
                FunctionDeclaration: (path) => {
                    // Skip if already handled by export
                    if (path.parent && (t.isExportNamedDeclaration(path.parent) || t.isExportDefaultDeclaration(path.parent))) {
                        return;
                    }
                    
                    const name = path.node.id?.name;
                    this.debugInfo.analysisLog.push(`Found function declaration: ${name}`);
                    
                    if (this.isReactComponent(path.node, name)) {
                        this.debugInfo.analysisLog.push(`✓ ${name} identified as React component`);
                        const component = this.analyzeComponent(path.node, filePath, name as string);
                        if (component) {
                            components.push(component);
                        }
                    } else {
                        this.debugInfo.analysisLog.push(`✗ ${name} not identified as React component`);
                    }
                },

                // Arrow function components
                VariableDeclarator: (path) => {
                    // Skip if already handled by export
                    const parent = path.parentPath?.parent;
                    if (parent && (t.isExportNamedDeclaration(parent) || t.isExportDefaultDeclaration(parent))) {
                        return;
                    }
                    
                    if (t.isIdentifier(path.node.id)) {
                        const name = path.node.id.name;
                        if (!name) return;
                        
                        if (t.isArrowFunctionExpression(path.node.init) || 
                            t.isFunctionExpression(path.node.init)) {
                            
                            this.debugInfo.analysisLog.push(`Found arrow/function expression: ${name}`);
                            
                            if (this.isReactComponent(path.node.init, name)) {
                                this.debugInfo.analysisLog.push(`✓ ${name} identified as React component`);
                                const component = this.analyzeComponent(path.node, filePath, name as string);
                                if (component) {
                                    components.push(component);
                                }
                            } else {
                                this.debugInfo.analysisLog.push(`✗ ${name} not identified as React component`);
                            }
                        }
                    }
                },

                // Class components
                ClassDeclaration: (path) => {
                    const name = path.node.id?.name;
                    if (!name) return;
                    
                    this.debugInfo.analysisLog.push(`Found class declaration: ${name}`);
                    
                    if (this.isReactClassComponent(path.node)) {
                        this.debugInfo.analysisLog.push(`✓ ${name} identified as React class component`);
                        const component = this.analyzeClassComponent(path.node, filePath);
                        if (component) {
                            components.push(component);
                        }
                    } else {
                        this.debugInfo.analysisLog.push(`✗ ${name} not identified as React class component`);
                    }
                }
            });

        } catch (error) {
            const errorMsg = `Error parsing ${filePath}: ${error}`;
            this.debugInfo.parseErrors.push(errorMsg);
            console.error(errorMsg);
        }

        this.debugInfo.analysisLog.push(`Found ${components.length} components in ${path.basename(filePath)}`);
        
        // For re-export files, try to analyze the imported files
        if (components.length === 0 && importedComponents.size > 0) {
            this.debugInfo.analysisLog.push(`File appears to be a re-export file with ${importedComponents.size} imports`);
            
            for (const [componentName, sourcePath] of importedComponents.entries()) {
                this.debugInfo.analysisLog.push(`  Following import: ${componentName} from ${sourcePath}`);
                
                if (fs.existsSync(sourcePath) && !this.debugInfo.filesAnalyzed.includes(sourcePath)) {
                    try {
                        const importedComponents = await this.analyzeFile(sourcePath);
                        components.push(...importedComponents);
                    } catch (error) {
                        this.debugInfo.analysisLog.push(`  Error analyzing imported file ${sourcePath}: ${error}`);
                    }
                }
            }
        }
        
        return components;
    }

    private resolveImportPath(fromFile: string, importPath: string): string | null {
        const dir = path.dirname(fromFile);
        let resolved = path.resolve(dir, importPath);
        
        // Try common extensions
        const extensions = ['.tsx', '.ts', '.jsx', '.js'];
        
        // If no extension, try adding one
        if (!path.extname(resolved)) {
            for (const ext of extensions) {
                const withExt = resolved + ext;
                if (fs.existsSync(withExt)) {
                    return withExt;
                }
            }
            
            // Try index files
            for (const ext of extensions) {
                const indexPath = path.join(resolved, 'index' + ext);
                if (fs.existsSync(indexPath)) {
                    return indexPath;
                }
            }
        } else if (fs.existsSync(resolved)) {
            return resolved;
        }
        
        return null;
    }

    private isReactComponent(node: any, name?: string): boolean {
        // Check if function name starts with uppercase (React convention)
        if (name && !/^[A-Z]/.test(name)) {
            this.debugInfo.analysisLog.push(`  ${name} rejected: doesn't start with uppercase`);
            return false;
        }

        // Check if function returns JSX by walking the node tree manually
        let hasJSX = false;
        let returnStatements = 0;
        
        const checkNode = (n: any): void => {
            if (!n) return;
            
            // Check for JSX
            if (t.isJSXElement(n) || t.isJSXFragment(n)) {
                hasJSX = true;
                this.debugInfo.analysisLog.push(`  ${name} contains JSX`);
                return;
            }
            
            // Check return statements
            if (t.isReturnStatement(n)) {
                returnStatements++;
                if (n.argument) {
                    // Direct JSX return
                    if (t.isJSXElement(n.argument) || t.isJSXFragment(n.argument)) {
                        hasJSX = true;
                        this.debugInfo.analysisLog.push(`  ${name} returns JSX directly`);
                        return;
                    }
                    
                    // Conditional JSX: condition ? <JSX /> : null
                    if (t.isConditionalExpression(n.argument)) {
                        if (t.isJSXElement(n.argument.consequent) || t.isJSXFragment(n.argument.consequent) ||
                            t.isJSXElement(n.argument.alternate) || t.isJSXFragment(n.argument.alternate)) {
                            hasJSX = true;
                            this.debugInfo.analysisLog.push(`  ${name} returns JSX conditionally`);
                            return;
                        }
                    }
                    
                    // Logical expression: condition && <JSX />
                    if (t.isLogicalExpression(n.argument)) {
                        if (t.isJSXElement(n.argument.right) || t.isJSXFragment(n.argument.right)) {
                            hasJSX = true;
                            this.debugInfo.analysisLog.push(`  ${name} returns JSX in logical expression`);
                            return;
                        }
                    }
                    
                    // Parenthesized expression: return (<JSX />)
                    if (t.isParenthesizedExpression(n.argument)) {
                        if (t.isJSXElement(n.argument.expression) || t.isJSXFragment(n.argument.expression)) {
                            hasJSX = true;
                            this.debugInfo.analysisLog.push(`  ${name} returns JSX in parentheses`);
                            return;
                        }
                    }
                }
            }
            
            // Recursively check child nodes
            if (typeof n === 'object') {
                for (const key in n) {
                    if (key === 'loc' || key === 'start' || key === 'end') continue; // Skip location info
                    const value = n[key];
                    if (Array.isArray(value)) {
                        value.forEach(item => checkNode(item));
                    } else if (value && typeof value === 'object') {
                        checkNode(value);
                    }
                }
            }
        };
        
        try {
            // Get the function body
            let body = null;
            if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
                body = node.body;
            } else if (t.isArrowFunctionExpression(node)) {
                // Arrow functions might have expression bodies
                if (t.isBlockStatement(node.body)) {
                    body = node.body;
                } else {
                    // Expression body: const Comp = () => <div />
                    body = node.body;
                }
            } else if (t.isVariableDeclarator(node)) {
                // Handle const Comp = () => {}
                if (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init)) {
                    if (t.isBlockStatement(node.init.body)) {
                        body = node.init.body;
                    } else {
                        body = node.init.body;
                    }
                }
            }
            
            if (body) {
                checkNode(body);
            }
            
        } catch (error) {
            this.debugInfo.analysisLog.push(`  Error checking JSX for ${name}: ${error}`);
        }

        this.debugInfo.analysisLog.push(`  ${name}: hasJSX=${hasJSX}, returnStatements=${returnStatements}`);
        
        // If it has JSX or looks like a component (uppercase + has returns), consider it a component
        const isComponent = hasJSX || (!!name && /^[A-Z]/.test(name) && returnStatements > 0);
        return isComponent;
    }

    private isReactClassComponent(node: t.ClassDeclaration): boolean {
        if (!node.superClass) return false;
        
        // Check for extends React.Component or extends Component
        if (t.isMemberExpression(node.superClass)) {
            return t.isIdentifier(node.superClass.property) && 
                   node.superClass.property.name === 'Component';
        }
        
        if (t.isIdentifier(node.superClass)) {
            return node.superClass.name === 'Component';
        }
        
        return false;
    }

    private analyzeComponent(node: any, filePath: string, componentName: string): ComponentData | null {
        if (!componentName) return null;

        const items: ComponentItem[] = [];
        let itemCounter = 0;

        this.debugInfo.analysisLog.push(`Analyzing component: ${componentName}`);

        try {
            traverse(node, {
                CallExpression: (path) => {
                    const callee = path.node.callee;
                    
                    if (t.isIdentifier(callee)) {
                        // useState hook
                        if (callee.name === 'useState') {
                            this.debugInfo.analysisLog.push(`Found useState in ${componentName}`);
                            
                            const parent = path.parent;
                            if (t.isVariableDeclarator(parent) && t.isArrayPattern(parent.id)) {
                                const elements = parent.id.elements;
                                if (elements.length >= 2) {
                                    const stateName = t.isIdentifier(elements[0]) ? elements[0].name : `state${itemCounter++}`;
                                    const setterName = t.isIdentifier(elements[1]) ? elements[1].name : `setter${itemCounter++}`;
                                    
                                    this.debugInfo.analysisLog.push(`  State: ${stateName}, Setter: ${setterName}`);
                                    
                                    items.push({
                                        id: `${componentName}-${stateName}`,
                                        name: stateName,
                                        type: 'state',
                                        color: '#22c55e',
                                        flowId: `${stateName}-flow`
                                    });

                                    items.push({
                                        id: `${componentName}-${setterName}`,
                                        name: setterName,
                                        type: 'setter',
                                        color: '#10b981',
                                        flowId: `${stateName}-flow`
                                    });
                                }
                            }
                        }

                        // useReducer hook
                        if (callee.name === 'useReducer') {
                            this.debugInfo.analysisLog.push(`Found useReducer in ${componentName}`);
                            
                            const parent = path.parent;
                            if (t.isVariableDeclarator(parent) && t.isArrayPattern(parent.id)) {
                                const elements = parent.id.elements;
                                if (elements.length >= 2) {
                                    const stateName = t.isIdentifier(elements[0]) ? elements[0].name : `state${itemCounter++}`;
                                    const dispatchName = t.isIdentifier(elements[1]) ? elements[1].name : `dispatch${itemCounter++}`;
                                    
                                    this.debugInfo.analysisLog.push(`  Reducer State: ${stateName}, Dispatch: ${dispatchName}`);
                                    
                                    items.push({
                                        id: `${componentName}-${stateName}`,
                                        name: stateName,
                                        type: 'state',
                                        color: '#22c55e',
                                        flowId: `${stateName}-flow`
                                    });

                                    items.push({
                                        id: `${componentName}-${dispatchName}`,
                                        name: dispatchName,
                                        type: 'setter',
                                        color: '#10b981',
                                        flowId: `${stateName}-flow`
                                    });
                                }
                            }
                        }

                        // useContext hook
                        if (callee.name === 'useContext') {
                            this.debugInfo.analysisLog.push(`Found useContext in ${componentName}`);
                            
                            const parent = path.parent;
                            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                                items.push({
                                    id: `${componentName}-${parent.id.name}`,
                                    name: `${parent.id.name}()`,
                                    type: 'context-consumer',
                                    color: '#8b5cf6',
                                    flowId: `${parent.id.name}-context`
                                });
                            }
                        }
                    }

                    // Context Provider detection
                    if (t.isMemberExpression(callee) && 
                        t.isIdentifier(callee.property) && 
                        callee.property.name === 'Provider') {
                        
                        const contextName = t.isIdentifier(callee.object) ? callee.object.name : 'Context';
                        this.debugInfo.analysisLog.push(`Found Context Provider: ${contextName}`);
                        
                        items.push({
                            id: `${componentName}-${contextName}Provider`,
                            name: `${contextName}Provider`,
                            type: 'context-provider',
                            color: '#ec4899',
                            flowId: `${contextName}-context`
                        });
                    }
                },

                // Function declarations within component
                FunctionDeclaration: (path) => {
                    if (path.node.id && path.node.id.name !== componentName) {
                        this.debugInfo.analysisLog.push(`Found function: ${path.node.id.name}`);
                        items.push({
                            id: `${componentName}-${path.node.id.name}`,
                            name: path.node.id.name,
                            type: 'function',
                            color: '#3b82f6',
                            flowId: `${path.node.id.name}-flow`
                        });
                    }
                },

                // Arrow functions assigned to variables
                VariableDeclarator: (path) => {
                    if (t.isArrowFunctionExpression(path.node.init) && 
                        t.isIdentifier(path.node.id)) {
                        this.debugInfo.analysisLog.push(`Found arrow function: ${path.node.id.name}`);
                        items.push({
                            id: `${componentName}-${path.node.id.name}`,
                            name: path.node.id.name,
                            type: 'function',
                            color: '#3b82f6',
                            flowId: `${path.node.id.name}-flow`
                        });
                    }
                }
            });

        } catch (error) {
            this.debugInfo.analysisLog.push(`Error analyzing component ${componentName}: ${error}`);
        }

        // Analyze props
        const props = this.extractProps(node, componentName);
        items.push(...props.map(prop => ({
            id: `${componentName}-${prop}`,
            name: prop,
            type: 'prop' as const,
            color: '#f59e0b',
            flowId: `${prop}-flow`
        })));

        this.debugInfo.analysisLog.push(`Component ${componentName} analysis complete: ${items.length} items found`);

        return {
            id: componentName,
            filePath,
            name: componentName,
            x: 0,
            y: 0,
            width: Math.max(200, componentName.length * 8 + 40),
            height: Math.max(100, items.length * 18 + 60),
            items
        };
    }

    private analyzeClassComponent(node: t.ClassDeclaration, filePath: string): ComponentData | null {
        const componentName = node.id?.name;
        if (!componentName) return null;

        const items: ComponentItem[] = [];

        this.debugInfo.analysisLog.push(`Analyzing class component: ${componentName}`);

        try {
            traverse(node, {
                ClassMethod: (path) => {
                    if (t.isIdentifier(path.node.key)) {
                        const methodName = path.node.key.name;
                        if (methodName !== 'render' && methodName !== 'constructor') {
                            this.debugInfo.analysisLog.push(`Found class method: ${methodName}`);
                            items.push({
                                id: `${componentName}-${methodName}`,
                                name: methodName,
                                type: 'function',
                                color: '#3b82f6',
                                flowId: `${methodName}-flow`
                            });
                        }
                    }
                }
            });

        } catch (error) {
            this.debugInfo.analysisLog.push(`Error analyzing class component ${componentName}: ${error}`);
        }

        return {
            id: componentName,
            filePath,
            name: componentName,
            x: 0,
            y: 0,
            width: Math.max(200, componentName.length * 8 + 40),
            height: Math.max(100, items.length * 18 + 60),
            items
        };
    }

    private extractProps(node: any, componentName: string): string[] {
        const props: string[] = [];
        
        this.debugInfo.analysisLog.push(`Extracting props for: ${componentName}`);

        try {
            // Get function parameters
            let params: any[] = [];
            
            if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
                params = node.params;
            } else if (t.isArrowFunctionExpression(node)) {
                params = node.params;
            } else if (t.isVariableDeclarator(node)) {
                if (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init)) {
                    params = node.init.params;
                }
            }

            // Check first parameter for props
            if (params.length > 0) {
                const firstParam = params[0];
                
                // Destructured props: function Component({prop1, prop2}) {}
                if (t.isObjectPattern(firstParam)) {
                    firstParam.properties.forEach((prop: any) => {
                        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                            props.push(prop.key.name);
                            this.debugInfo.analysisLog.push(`  Found destructured prop: ${prop.key.name}`);
                        } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
                            props.push(`...${prop.argument.name}`);
                            this.debugInfo.analysisLog.push(`  Found rest props: ...${prop.argument.name}`);
                        }
                    });
                }
                // Regular props parameter: function Component(props) {}
                else if (t.isIdentifier(firstParam) && firstParam.name === 'props') {
                    this.debugInfo.analysisLog.push(`  Found props parameter, looking for props.* usage`);
                    
                    // Walk the function body to find props.something usage
                    const findPropsUsage = (n: any): void => {
                        if (!n || typeof n !== 'object') return;
                        
                        // Check for props.propertyName
                        if (t.isMemberExpression(n)) {
                            if (t.isIdentifier(n.object) && n.object.name === 'props' &&
                                t.isIdentifier(n.property)) {
                                if (!props.includes(n.property.name)) {
                                    props.push(n.property.name);
                                    this.debugInfo.analysisLog.push(`  Found prop usage: props.${n.property.name}`);
                                }
                            }
                        }
                        
                        // Recursively check child nodes
                        for (const key in n) {
                            if (key === 'loc' || key === 'start' || key === 'end') continue;
                            const value = n[key];
                            if (Array.isArray(value)) {
                                value.forEach(item => findPropsUsage(item));
                            } else if (value && typeof value === 'object') {
                                findPropsUsage(value);
                            }
                        }
                    };
                    
                    // Get function body
                    let body = null;
                    if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
                        body = node.body;
                    } else if (t.isArrowFunctionExpression(node)) {
                        body = node.body;
                    } else if (t.isVariableDeclarator(node) && 
                              (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init))) {
                        body = node.init.body;
                    }
                    
                    if (body) {
                        findPropsUsage(body);
                    }
                }
            }

        } catch (error) {
            this.debugInfo.analysisLog.push(`Error extracting props for ${componentName}: ${error}`);
        }

        this.debugInfo.analysisLog.push(`Extracted ${props.length} props for ${componentName}: [${props.join(', ')}]`);
        return props;
    }

    private async analyzeJSXFlows(
        reactFiles: string[], 
        componentMap: Map<string, ComponentData>
    ): Promise<DataFlow[]> {
        const flows: DataFlow[] = [];
        const flowIdCounter = new Map<string, number>();

        for (const filePath of reactFiles) {
            try {
                const code = fs.readFileSync(filePath, 'utf-8');
                const ast = parse(code, {
                    sourceType: 'module',
                    plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties']
                });

                // Find JSX element usage
                traverse(ast, {
                    JSXElement: (path: any) => {
                        const openingElement = path.node.openingElement;
                        if (t.isJSXIdentifier(openingElement.name)) {
                            const componentName = openingElement.name.name;
                            
                            // Only process if it's a known component (starts with uppercase)
                            if (!/^[A-Z]/.test(componentName)) return;
                            
                            const childComponent = componentMap.get(componentName);
                            if (!childComponent) return;

                            // Find parent component
                            let parentComponent: ComponentData | undefined;
                            let currentPath = path.parentPath;
                            
                            while (currentPath) {
                                const node = currentPath.node;
                                if (t.isFunctionDeclaration(node) && node.id) {
                                    parentComponent = componentMap.get(node.id.name);
                                    break;
                                } else if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
                                    parentComponent = componentMap.get(node.id.name);
                                    break;
                                }
                                currentPath = currentPath.parentPath;
                            }

                            if (!parentComponent) return;

                            this.debugInfo.analysisLog.push(
                                `Found JSX: ${parentComponent.name} renders ${childComponent.name}`
                            );

                            // Analyze props being passed
                            openingElement.attributes.forEach((attr: any) => {
                                if (!t.isJSXAttribute(attr)) return;
                                if (!t.isJSXIdentifier(attr.name)) return;
                                if (!parentComponent) return; // Guard clause

                                const propName = attr.name.name;
                                const propValue = attr.value;

                                // Find matching items in parent and child
                                const childPropItem = childComponent.items.find(
                                    item => item.name === propName && (item.type === 'prop' || item.type === 'prop-function')
                                );

                                if (!childPropItem) return;

                                // Try to find what's being passed
                                let parentItem: ComponentItem | undefined;

                                if (t.isJSXExpressionContainer(propValue)) {
                                    const expr = propValue.expression;
                                    
                                    // Direct identifier: <Child prop={value} />
                                    if (t.isIdentifier(expr)) {
                                        const valueName = expr.name;
                                        parentItem = parentComponent.items.find(
                                            item => item.name === valueName
                                        );
                                    }
                                    // Member expression: <Child prop={this.state.value} />
                                    else if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) {
                                        const valueName = expr.property.name;
                                        parentItem = parentComponent.items.find(
                                            item => item.name === valueName
                                        );
                                    }
                                }

                                if (parentItem) {
                                    const flowId = `${propName}-flow`;
                                    const flowType = this.determineFlowType(parentItem.type, childPropItem.type);

                                    flows.push({
                                        id: flowId,
                                        fromItem: parentItem.id,
                                        toItem: childPropItem.id,
                                        type: flowType
                                    });

                                    this.debugInfo.analysisLog.push(
                                        `  Flow: ${parentComponent.name}.${parentItem.name} → ${childComponent.name}.${propName}`
                                    );
                                }
                            });
                        }
                    }
                });

            } catch (error) {
                this.debugInfo.analysisLog.push(`Error analyzing JSX flows in ${filePath}: ${error}`);
            }
        }

        return flows;
    }

    private determineFlowType(fromType: string, toType: string): string {
        if (fromType === 'state' && toType === 'prop') return 'state-to-prop';
        if (fromType === 'setter' && toType === 'prop-function') return 'setter-to-prop';
        if (fromType === 'function' && toType === 'prop-function') return 'function-to-prop';
        if (fromType === 'prop' && toType === 'prop') return 'prop-to-prop';
        if (fromType === 'context-provider') return 'context-provider-to-consumer';
        return 'data-flow';
    }

    private detectConflicts(components: ComponentData[], flows: DataFlow[]): ConflictData[] {
        const conflicts: ConflictData[] = [];
        
        // Find props that have same name as context consumers in same component
        components.forEach(component => {
            const props = component.items.filter(item => item.type === 'prop');
            const contextConsumers = component.items.filter(item => item.type === 'context-consumer');
            
            props.forEach(prop => {
                const similarContext = contextConsumers.find(ctx => {
                    // Remove common suffixes/prefixes to compare
                    const propBase = prop.name.replace(/^(get|set|use)/, '').toLowerCase();
                    const ctxBase = ctx.name.replace(/^(get|set|use)|\(\)$/g, '').toLowerCase();
                    return propBase === ctxBase || propBase.includes(ctxBase) || ctxBase.includes(propBase);
                });

                if (similarContext) {
                    const conflictId = `${component.name}-${prop.name}-conflict`;
                    if (!conflicts.find(c => c.id === conflictId)) {
                        conflicts.push({
                            id: conflictId,
                            description: `${component.name} receives "${prop.name}" via both props and context`,
                            items: [prop.id, similarContext.id]
                        });
                    }
                }
            });
        });

        return conflicts;
    }

    private generateBasicFlows(components: ComponentData[]): DataFlow[] {
        const flows: DataFlow[] = [];
        
        // Simple heuristic: if multiple components have props/state with similar names,
        // assume they might be related
        const propNames = new Map<string, ComponentData[]>();
        
        components.forEach(component => {
            component.items.forEach(item => {
                if (item.type === 'prop' || item.type === 'state') {
                    if (!propNames.has(item.name)) {
                        propNames.set(item.name, []);
                    }
                    propNames.get(item.name)!.push(component);
                }
            });
        });

        // Create flows between components that share prop names
        propNames.forEach((componentList, propName) => {
            if (componentList.length > 1) {
                this.debugInfo.analysisLog.push(`Creating flow for shared prop: ${propName}`);
                
                for (let i = 0; i < componentList.length - 1; i++) {
                    const fromComponent = componentList[i];
                    const toComponent = componentList[i + 1];
                    
                    const fromItem = fromComponent.items.find(item => 
                        item.name === propName && item.type === 'state');
                    const toItem = toComponent.items.find(item => 
                        item.name === propName && item.type === 'prop');
                    
                    if (fromItem && toItem) {
                        flows.push({
                            id: `${propName}-flow`,
                            fromItem: fromItem.id,
                            toItem: toItem.id,
                            type: 'state-to-prop'
                        });
                    }
                }
            }
        });

        this.debugInfo.analysisLog.push(`Generated ${flows.length} basic flows`);
        return flows;
    }

    private layoutComponents(components: ComponentData[]): ComponentData[] {
        // Simple grid layout
        const cols = Math.ceil(Math.sqrt(components.length));
        const spacing = 50;
        
        return components.map((component, index) => ({
            ...component,
            x: (index % cols) * (component.width + spacing) + 50,
            y: Math.floor(index / cols) * (component.height + spacing) + 50
        }));
    }
}