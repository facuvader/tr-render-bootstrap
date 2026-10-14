'use strict';
// Generic build launcher. Business code stays in a PRIVATE repository.
// It accepts a repository-scoped READ-ONLY SSH deploy key, never a GitHub PAT.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process');
const HOST_KEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n';
const HOST_FINGERPRINT='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU';
const ROOT=__dirname,TARGET=path.join(ROOT,'app-source'),MARKER='.tr-private-source.json';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function configuration(env=process.env){
  assert.match(env.TR_SOURCE_REPOSITORY||'',/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);
  assert.ok(!env.TR_SOURCE_REPOSITORY.includes('..'));assert.match(env.TR_SOURCE_COMMIT||'',/^[a-f0-9]{40}$/);
  assert.match(env.TR_SOURCE_FILE_COUNT||'',/^\d{1,3}$/);const count=Number(env.TR_SOURCE_FILE_COUNT);assert.ok(count>0&&count<=200);
  return {repository:env.TR_SOURCE_REPOSITORY,commit:env.TR_SOURCE_COMMIT,count};
}
function privateKey(env=process.env){const encoded=env.TR_SOURCE_SSH_PRIVATE_KEY||'';assert.ok(encoded.length>200&&encoded.length<16000&&/^[A-Za-z0-9+/]+={0,2}$/.test(encoded));
  const decoded=Buffer.from(encoded,'base64').toString('utf8');assert.equal(Buffer.from(decoded).toString('base64'),encoded);
  assert.match(decoded,/^-----BEGIN OPENSSH PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END OPENSSH PRIVATE KEY-----\n$/);return decoded;
}
function publicHostKey(){const encoded=HOST_KEY.trim().split(' ')[2],actual='SHA256:'+crypto.createHash('sha256').update(Buffer.from(encoded,'base64')).digest('base64').replace(/=+$/,'');assert.equal(actual,HOST_FINGERPRINT);return HOST_KEY;}
function cleanEnvironment(env=process.env){const clean={...env};for(const key of Object.keys(clean))if(/^(?:TR_|GIT_|SSH_|GH_|GITHUB_)/.test(key)||key.includes('FIREBASE')||/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(key))delete clean[key];return clean;}
function run(binary,args,options={}){const reply=spawnSync(binary,args,{encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:1000000,...options});if(reply.error||reply.status!==0){const failure=Error('Private build operation did not succeed.');failure.operation=path.basename(binary)+':'+(args[0]||'');failure.exitStatus=reply.status;failure.code=reply.error?.code;failure.category=/permission denied/i.test(reply.stderr||'')?'access-denied':/timed out|could not resolve|unable to connect/i.test(reply.stderr||'')?'network':/certificate/i.test(reply.stderr||'')?'tls':undefined;throw failure;}return reply.stdout||'';}
function regularTree(directory){assert.ok(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink());return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  if(entry.name==='.git')return [];assert.ok(!entry.isSymbolicLink());const file=path.join(directory,entry.name);return entry.isDirectory()?regularTree(file):[file];});}
function removeOwnedTemp(directory){const absolute=path.resolve(directory),parent=path.resolve(os.tmpdir());assert.equal(path.dirname(absolute),parent);assert.ok(path.basename(absolute).startsWith('tr-render-source-'));assert.ok(!fs.lstatSync(absolute).isSymbolicLink());fs.rmSync(absolute,{recursive:true});}
function build({env=process.env,install=true,protectTemp}={}){const config=configuration(env),key=privateKey(env);assert.ok(!fs.existsSync(TARGET),'A clean deployment checkout is required; never erase an unknown directory.');
  assert.ok(process.platform!=='win32'||typeof protectTemp==='function','Windows test builds need a verified NTFS privacy callback before any key is written.');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tr-render-source-')),keyFile=path.join(temp,'key'),known=path.join(temp,'known_hosts'),sshConfig=path.join(temp,'ssh_config'),gitConfig=path.join(temp,'git_config'),source=path.join(temp,'source');
  try{if(process.platform==='win32')assert.equal(protectTemp(temp),true);fs.writeFileSync(keyFile,key,{mode:0o600,flag:'wx'});fs.writeFileSync(known,publicHostKey(),{mode:0o600,flag:'wx'});
    const quote=v=>'"'+v.replaceAll('\\','/')+'"';const configText=`Host github.com\n  HostName github.com\n  User git\n  IdentityFile ${quote(keyFile)}\n  IdentitiesOnly yes\n  BatchMode yes\n  PasswordAuthentication no\n  KbdInteractiveAuthentication no\n  StrictHostKeyChecking yes\n  HostKeyAlgorithms ssh-ed25519\n  UserKnownHostsFile ${quote(known)}\n  GlobalKnownHostsFile ${quote(known)}\n  AddKeysToAgent no\n  ConnectTimeout 15\n  LogLevel ERROR\n`;
    fs.writeFileSync(sshConfig,configText,{mode:0o600,flag:'wx'});fs.writeFileSync(gitConfig,'',{mode:0o600,flag:'wx'});fs.mkdirSync(source);
    const gitEnv={...cleanEnvironment(env),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:gitConfig,GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:`ssh -F ${quote(sshConfig)}`};
    run('git',['init','--quiet'],{cwd:source,env:gitEnv});run('git',['remote','add','origin',`git@github.com:${config.repository}.git`],{cwd:source,env:gitEnv});
    run('git',['fetch','--quiet','--depth=1','--no-tags','origin',config.commit],{cwd:source,env:gitEnv});run('git',['checkout','--quiet','--detach',config.commit],{cwd:source,env:gitEnv});
    assert.equal(run('git',['rev-parse','HEAD'],{cwd:source,env:gitEnv}).trim(),config.commit);
    const files=regularTree(source);assert.equal(files.length,config.count);const hashes={};
    for(const file of files){const name=path.relative(source,file).replaceAll('\\','/');assert.ok(!name.startsWith('.')||name==='.gitignore');assert.match(name,/^[a-zA-Z0-9_.\/-]+$/);assert.ok(!name.includes('..')&&!name.endsWith('.apk')&&!name.endsWith('.aab'));
      const content=fs.readFileSync(file);assert.ok(!/-----BEGIN (?:OPENSSH|RSA|EC)? ?PRIVATE KEY-----\r?\n|"private_key"\s*:\s*"/.test(content.toString('utf8')));hashes[name]=hash(content);}
    assert.ok(hashes['server.cjs']&&hashes['package.json']);const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));assert.equal(pkg.private,true);
    fs.mkdirSync(TARGET);for(const file of files){const name=path.relative(source,file),dest=path.join(TARGET,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);}
    fs.writeFileSync(path.join(TARGET,MARKER),JSON.stringify({schema:1,repository:config.repository,commit:config.commit,hashes})+'\n',{flag:'wx'});
    if(install){const options={cwd:TARGET,env:cleanEnvironment(env)};if(process.platform==='win32')run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm install --omit=dev --ignore-scripts --no-audit --no-fund'],options);
      else run('npm',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],options);}
    return {sourceFiles:files.length,commit:config.commit,hostKeyPinned:true,privateKeyCopiedIntoArtifact:false};
  }finally{removeOwnedTemp(temp);}
}
function validateStart(env=process.env){const expected=configuration(env);assert.ok(fs.lstatSync(TARGET).isDirectory()&&!fs.lstatSync(TARGET).isSymbolicLink());const marker=path.join(TARGET,MARKER);assert.ok(fs.lstatSync(marker).isFile()&&!fs.lstatSync(marker).isSymbolicLink());
  const saved=JSON.parse(fs.readFileSync(marker,'utf8'));assert.equal(saved.schema,1);assert.equal(saved.repository,expected.repository);assert.equal(saved.commit,expected.commit);assert.equal(Object.keys(saved.hashes).length,expected.count);
  for(const [name,value]of Object.entries(saved.hashes)){assert.match(name,/^[a-zA-Z0-9_.\/-]+$/);assert.ok(!name.includes('..'));const file=path.join(TARGET,name);assert.ok(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink());assert.equal(hash(fs.readFileSync(file)),value);}
  return path.join(TARGET,'server.cjs');
}
function start(){const file=validateStart(),env={...process.env};for(const key of Object.keys(env))if(key.startsWith('TR_SOURCE_'))delete env[key];
  const child=spawn(process.execPath,[file],{cwd:TARGET,env,stdio:'inherit'});child.once('error',()=>{console.error('El servidor privado no pudo iniciarse.');process.exitCode=1;});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));child.once('exit',code=>{process.exitCode=code===0?0:1;});
}
if(require.main===module){try{if(process.argv[2]==='build'){const result=build();console.log(JSON.stringify({build:'private-source-ready',sourceFiles:result.sourceFiles,privateCredentialsLogged:false}));}
  else if(process.argv[2]==='start')start();else throw Error('Unknown mode');}catch{console.error('No se pudo preparar el servidor privado. Revisá el commit y los secretos de ensayo; no se mostraron credenciales.');process.exitCode=1;}}
module.exports={configuration,privateKey,publicHostKey,cleanEnvironment,build,validateStart};
