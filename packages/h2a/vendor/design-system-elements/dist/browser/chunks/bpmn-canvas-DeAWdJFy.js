import{t as e}from"../elements.js";import{E as t,_ as n,a as r,d as i,f as a,l as o,n as s,o as c,s as l,t as u,v as d,w as f}from"./dist-Co2MgHWm.js";var p=Object.defineProperty,m=(e,t)=>{let n={};for(var r in e)p(n,r,{get:e[r],enumerable:!0});return t||p(n,Symbol.toStringTag,{value:`Module`}),n};function h(){}h.prototype.get=function(e){return this.$model.properties.get(this,e)},h.prototype.set=function(e,t){this.$model.properties.set(this,e,t)};function g(e,t){this.model=e,this.properties=t}g.prototype.createType=function(e){var t=this.model,n=this.properties,r=Object.create(h.prototype);o(e.properties,function(e){!e.isMany&&e.default!==void 0&&(r[e.name]=e.default)}),n.defineModel(r,t),n.defineDescriptor(r,e);var i=e.ns.name;function a(e){n.define(this,`$type`,{value:i,enumerable:!0}),n.define(this,`$attrs`,{value:{}}),n.define(this,`$parent`,{writable:!0}),o(e,s(function(e,t){this.set(t,e)},this))}return a.prototype=r,a.hasType=r.$instanceOf=this.model.hasType,n.defineModel(a,t),n.defineDescriptor(a,e),a};var _=u(Object.create(null),{String:!0,Boolean:!0,Integer:!0,Real:!0,Element:!0}),v=u(Object.create(null),{String:function(e){return e},Boolean:function(e){return e===`true`},Integer:function(e){return parseInt(e,10)},Real:function(e){return parseFloat(e)}});function y(e,t){var n=v[e];return n?n(t):t}function b(e){return!!_[e]}function x(e){return!!v[e]}function S(e,t){var n=e.split(/:/),r,i;if(n.length===1)r=e,i=t;else if(n.length===2)r=n[1],i=n[0];else throw Error(`expected <prefix:localName> or <localName>, got `+e);return e=(i?i+`:`:``)+r,{name:e,prefix:i,localName:r}}function C(e){this.ns=e,this.name=e.name,this.allTypes=[],this.allTypesByName=Object.create(null),this.properties=[],this.propertiesByName=Object.create(null)}C.prototype.build=function(){return f(this,[`ns`,`name`,`allTypes`,`allTypesByName`,`properties`,`propertiesByName`,`bodyProperty`,`idProperty`])},C.prototype.addProperty=function(e,t,n){typeof t==`boolean`&&(n=t,t=void 0),this.addNamedProperty(e,n!==!1);var r=this.properties;t===void 0?r.push(e):r.splice(t,0,e)},C.prototype.replaceProperty=function(e,t,n){var r=e.ns,i=this.properties,a=this.propertiesByName,o=e.name!==t.name;if(e.isId){if(!t.isId)throw Error(`property <`+t.ns.name+`> must be id property to refine <`+e.ns.name+`>`);this.setIdProperty(t,!1)}if(e.isBody){if(!t.isBody)throw Error(`property <`+t.ns.name+`> must be body property to refine <`+e.ns.name+`>`);this.setBodyProperty(t,!1)}var s=i.indexOf(e);if(s===-1)throw Error(`property <`+r.name+`> not found in property list`);i.splice(s,1),this.addProperty(t,n?void 0:s,o),a[r.name]=a[r.localName]=t},C.prototype.redefineProperty=function(e,t,n){var r=e.ns.prefix,i=t.split(`#`),a=S(i[0],r),o=S(i[1],a.prefix).name,s=this.propertiesByName[o];if(s)this.replaceProperty(s,e,n);else throw Error(`refined property <`+o+`> not found`);delete e.redefines},C.prototype.addNamedProperty=function(e,t){var n=e.ns,r=this.propertiesByName;t&&(this.assertNotDefined(e,n.name),this.assertNotDefined(e,n.localName)),r[n.name]=r[n.localName]=e},C.prototype.removeNamedProperty=function(e){var t=e.ns,n=this.propertiesByName;delete n[t.name],delete n[t.localName]},C.prototype.setBodyProperty=function(e,t){if(t&&this.bodyProperty)throw Error(`body property defined multiple times (<`+this.bodyProperty.ns.name+`>, <`+e.ns.name+`>)`);this.bodyProperty=e},C.prototype.setIdProperty=function(e,t){if(t&&this.idProperty)throw Error(`id property defined multiple times (<`+this.idProperty.ns.name+`>, <`+e.ns.name+`>)`);this.idProperty=e},C.prototype.assertNotTrait=function(e){if((e.extends||[]).length)throw Error(`cannot create <${e.name}> extending <${e.extends}>`)},C.prototype.assertNotDefined=function(e,t){var n=e.name,r=this.propertiesByName[n];if(r)throw Error(`property <`+n+`> already defined; override of <`+r.definedBy.ns.name+`#`+r.ns.name+`> by <`+e.definedBy.ns.name+`#`+e.ns.name+`> not allowed without redefines`)},C.prototype.hasProperty=function(e){return this.propertiesByName[e]},C.prototype.addTrait=function(e,t){t&&this.assertNotTrait(e);var n=this.allTypesByName,r=this.allTypes,i=e.name;i in n||(o(e.properties,s(function(n){n=u({},n,{name:n.ns.localName,inherited:t}),Object.defineProperty(n,"definedBy",{value:e});var r=n.replaces,i=n.redefines;r||i?this.redefineProperty(n,r||i,r):(n.isBody&&this.setBodyProperty(n),n.isId&&this.setIdProperty(n),this.addProperty(n))},this)),r.push(e),n[i]=e)};function w(e,t){this.packageMap=Object.create(null),this.typeMap=Object.create(null),this.packages=[],this.properties=t,o(e,s(this.registerPackage,this))}w.prototype.getPackage=function(e){return this.packageMap[e]},w.prototype.getPackages=function(){return this.packages},w.prototype.registerPackage=function(e){e=u({},e);var t=this.packageMap;T(t,e,`prefix`),T(t,e,`uri`),o(e.types,s(function(t){this.registerType(t,e)},this)),t[e.uri]=t[e.prefix]=e,this.packages.push(e)},w.prototype.registerType=function(e,t){e=u({},e,{superClass:(e.superClass||[]).slice(),extends:(e.extends||[]).slice(),properties:(e.properties||[]).slice(),meta:u({},e.meta||{})});var n=S(e.name,t.prefix),r=n.name,i=Object.create(null);o(e.properties,s(function(e){var t=S(e.name,n.prefix),r=t.name;b(e.type)||(e.type=S(e.type,t.prefix).name),u(e,{ns:t,name:r}),i[r]=e},this)),u(e,{ns:n,name:r,propertiesByName:i}),o(e.extends,s(function(e){var t=S(e,n.prefix),i=this.typeMap[t.name];i.traits=i.traits||[],i.traits.push(r)},this)),this.definePackage(e,t),this.typeMap[r]=e},w.prototype.mapTypes=function(e,t,n){var r=b(e.name)?{name:e.name}:this.typeMap[e.name],i=this;function a(n,r){var a=S(n,b(n)?``:e.prefix);i.mapTypes(a,t,r)}function s(e){return a(e,!0)}function c(e){return a(e,!1)}if(!r)throw Error(`unknown type <`+e.name+`>`);o(r.superClass,n?s:c),t(r,!n),o(r.traits,s)},w.prototype.getEffectiveDescriptor=function(e){var t=S(e),n=new C(t);this.mapTypes(t,function(e,t){n.addTrait(e,t)});var r=n.build();return this.definePackage(r,r.allTypes[r.allTypes.length-1].$pkg),r},w.prototype.definePackage=function(e,t){this.properties.define(e,`$pkg`,{value:t})};function T(e,t,n){var r=t[n];if(r in e)throw Error(`package with `+n+` <`+r+`> already defined`)}function E(e){this.model=e}E.prototype.set=function(e,t,n){if(!d(t)||!t.length)throw TypeError(`property name must be a non-empty string`);var r=this.getProperty(e,t),i=r&&r.name;D(n)?r?delete e[i]:delete e.$attrs[k(t)]:r?i in e?e[i]=n:O(e,r,n):e.$attrs[k(t)]=n},E.prototype.get=function(e,t){var n=this.getProperty(e,t);if(!n)return e.$attrs[k(t)];var r=n.name;return!e[r]&&n.isMany&&O(e,n,[]),e[r]},E.prototype.define=function(e,t,n){if(!n.writable){var r=n.value;n=u({},n,{get:function(){return r}}),delete n.value}Object.defineProperty(e,t,n)},E.prototype.defineDescriptor=function(e,t){this.define(e,`$descriptor`,{value:t})},E.prototype.defineModel=function(e,t){this.define(e,`$model`,{value:t})},E.prototype.getProperty=function(e,t){var n=this.model,r=n.getPropertyDescriptor(e,t);if(r)return r;if(t.includes(`:`))return null;let i=n.config.strict;if(i!==void 0){let n=TypeError(`unknown property <${t}> on <${e.$type}>`);if(i)throw n;typeof console<`u`&&console.warn(n)}return null};function D(e){return e===void 0}function O(e,t,n){Object.defineProperty(e,t.name,{enumerable:!t.isReference,writable:!0,value:n,configurable:!0})}function k(e){return e.replace(/^:/,``)}function A(e,t={}){this.properties=new E(this),this.factory=new g(this,this.properties),this.registry=new w(e,this.properties),this.typeCache=Object.create(null),this.config=t}A.prototype.create=function(e,t){var n=this.getType(e);if(!n)throw Error(`unknown type <`+e+`>`);return new n(t)},A.prototype.getType=function(e){var t=this.typeCache,n=d(e)?e:e.ns.name,r=t[n];return r||=(e=this.registry.getEffectiveDescriptor(n),t[n]=this.factory.createType(e)),r},A.prototype.createAny=function(e,r,i){var a=S(e),s={$type:e,$instanceOf:function(e){return e===this.$type},get:function(e){return this[e]},set:function(e,n){t(this,[e],n)}},c={name:e,isGeneric:!0,ns:{prefix:a.prefix,localName:a.localName,uri:r}};return this.properties.defineDescriptor(s,c),this.properties.defineModel(s,this),this.properties.define(s,`get`,{enumerable:!1,writable:!0}),this.properties.define(s,`set`,{enumerable:!1,writable:!0}),this.properties.define(s,`$parent`,{enumerable:!1,writable:!0}),this.properties.define(s,`$instanceOf`,{enumerable:!1,writable:!0}),o(i,function(e,t){n(e)&&e.value!==void 0?s[e.name]=e.value:s[t]=e}),s},A.prototype.getPackage=function(e){return this.registry.getPackage(e)},A.prototype.getPackages=function(){return this.registry.getPackages()},A.prototype.getElementDescriptor=function(e){return e.$descriptor},A.prototype.hasType=function(e,t){t===void 0&&(t=e,e=this);var n=e.$model.getElementDescriptor(e);return t in n.allTypesByName},A.prototype.getPropertyDescriptor=function(e,t){return this.getElementDescriptor(e).propertiesByName[t]},A.prototype.getTypeDescriptor=function(e){return this.registry.typeMap[e]};var j=String.fromCharCode,M=Object.prototype.hasOwnProperty,ee=/&#(\d+);|&#x([0-9a-f]+);|&(\w+);/gi,N={amp:`&`,apos:`'`,gt:`>`,lt:`<`,quot:`"`};Object.keys(N).forEach(function(e){N[e.toUpperCase()]=N[e]});function P(e,t,n,r){return r?M.call(N,r)?N[r]:`&`+r+`;`:j(t||parseInt(n,16))}function F(e){return e.length>3&&e.indexOf(`&`)!==-1?e.replace(ee,P):e}var te=`non-whitespace outside of root node`;function I(e){return Error(e)}function ne(e){return`missing namespace for prefix <`+e+`>`}function re(e){return{get:e,enumerable:!0}}function ie(e,t,n,r){n in t||(t[n]=n in e?e[n]:null),e[n]=r}function ae(e,t){var n,r;for(n in t)r=t[n],r===null?delete e[n]:e[n]=r}function oe(e){return e+`$uri`}function se(e){var t=Object.create(null),n,r;for(n in e)r=e[n],t[r]=r,t[oe(r)]=n;return t}function L(){return{line:0,column:0}}function ce(e){throw e}function R(e){if(!this)return new R(e);var t=e&&e.proxy,n,r,i,a,o=ce,s,c,l,u,d=L,f=!1,p=!1,m=``,h=!1,g=!1,_=null,v=!1,y,b,x,S;function C(e){e instanceof Error||(e=I(e)),_=e,o(e,d)}function w(e){s&&(e instanceof Error||(e=I(e)),s(e,d))}this.on=function(e,t){if(typeof t!=`function`)throw I(`required args <name, cb>`);switch(e){case`openTag`:r=t;break;case`text`:n=t;break;case`closeTag`:i=t;break;case`error`:o=t;break;case`warn`:s=t;break;case`cdata`:a=t;break;case`attention`:u=t;break;case`question`:l=t;break;case`comment`:c=t;break;default:throw I(`unsupported event: `+e)}return this},this.ns=function(e){if(e===void 0&&(e={}),typeof e!=`object`)throw I(`required args <nsMap={}>`);var t=Object.create(null),n;for(n in e)t[n]=e[n];return g=!0,S=t,this};function T(){y=g?[]:null,b=g?se(S):null,x=[],d=L,v=!1,_=null,p=!1,m=``}this.parse=function(e){if(typeof e!=`string`)throw I(`required args <xml=string>`);if(f)throw I(`parse during stream; call end() first`);return T(),E(e),d=L,v=!1,_},this.write=function(e){if(typeof e!=`string`)throw I(`required args <xml=string>`);return f||=(T(),!0),_||(m=E(m+e,!0)||``),this},this.end=function(){return f||T(),f=!1,_||E(m),m=``,d=L,v=!1,_},this.stop=function(){v=!0};function E(e,o=!1){var s=null,f,m,_=0,T=!1,E=!1,D=0,O=0,k,A,j,M,ee,N,P,I,se,L=``,ce=0,R;function le(e,t){var n=e.indexOf(`:`);if(n===-1)return e;var r=b[e.substring(0,n)];return r?t===r?e.substr(n+1):r+e.substr(n):(w(ne(e.substring(0,n))),null)}function z(){if(R!==null)return R;var e,t,n=g&&b.xmlns,r=g&&h?[]:null,i=ce,a=L,o=a.length,c,l,u,d,p={},v=new Set,y,x,T;parseAttr:for(;i<o;i++)if(y=!1,x=a.charCodeAt(i),!(x===32||x<14&&x>8)){for((x<65||x>122||x>90&&x<97)&&x!==95&&x!==58&&(w(`illegal first char attribute name`),y=!0),T=i+1;T<o;T++)if(x=a.charCodeAt(T),!(x>96&&x<123||x>64&&x<91||x>47&&x<59||x===46||x===45||x===95)){if(x===32||x<14&&x>8){w(`missing attribute value`),i=T;continue parseAttr}if(x===61)break;w(`illegal attribute name char`),y=!0}if(d=a.substring(i,T),d===`xmlns:xmlns`&&(w(`illegal declaration of xmlns`),y=!0),x=a.charCodeAt(T+1),x===34)T=a.indexOf(`"`,i=T+2),T===-1&&(T=a.indexOf(`'`,i),T!==-1&&(w(`attribute value quote missmatch`),y=!0));else if(x===39)T=a.indexOf(`'`,i=T+2),T===-1&&(T=a.indexOf(`"`,i),T!==-1&&(w(`attribute value quote missmatch`),y=!0));else for(w(`missing attribute value quotes`),y=!0,T+=1;T<o&&(x=a.charCodeAt(T+1),!(x===32||x<14&&x>8));T++);for(T===-1&&(w(`missing closing quotes`),T=o,y=!0),y||(l=a.substring(i,T)),d===`xmlns:xml`&&l!==`http://www.w3.org/XML/1998/namespace`&&C(`illegal value of xmlns:xml`),i=T;T+1<o&&(x=a.charCodeAt(T+1),!(x===32||x<14&&x>8));T++)i===T&&(w(`illegal character after attribute end`),y=!0);if(i=T+1,y)continue parseAttr;if(v.has(d))w(`attribute <`+d+`> already defined`);else if(v.add(d),!g)p[d]=l;else if(h){if(c=d===`xmlns`?`xmlns`:d.charCodeAt(0)===120&&d.substr(0,6)===`xmlns:`?d.substr(6):null,c!==null){if(e=F(l),t=oe(c),u=S[e],!u){if(c===`xmlns`||t in b&&b[t]!==e)do u=`ns`+_++;while(b[u]!==void 0);else u=c;S[e]=u}b[c]!==u&&(f||=Object.create(null),s=null,m=null,ie(b,f,c,u),c===`xmlns`&&(ie(b,f,oe(u),e),n=u),ie(b,f,t,e)),p[d]=l;continue}r.push(d,l)}else d=le(d,n),d!==null&&(p[d]=l)}if(h)for(i=0,o=r.length;i<o;i++)d=le(r[i++],n),l=r[i],d!==null&&(p[d]=l);return R=p}function ue(){for(var t=/(\r\n|\r|\n)/g,n=0,r=0,i=0,a=O,o,s;D>=i&&(o=t.exec(e),!(!o||(a=o[0].length+o.index,a>D)));)n+=1,i=a;return D==-1?(r=a,s=e.substring(O)):O===0?s=e.substring(O,D):(r=D-i,s=O==-1?e.substring(D):e.substring(D,O+1)),{data:s,line:n,column:r}}for(d=ue,t&&(se=Object.create({},{name:re(function(){return P}),originalName:re(function(){return I}),attrs:re(z),ns:re(function(){return m||=Object.assign(Object.create(null),b),m})}));O!==-1;){if(D=e.charCodeAt(O)===60?O:e.indexOf(`<`,O),D===-1){if(o)return e.substring(O);if(x.length)return C(`unexpected end of file`);if(!p)return C(`missing start tag`);O<e.length&&e.substring(O).trim()&&w(te);return}if(p||=!0,O!==D){if(x.length){if(n&&(n(e.substring(O,D),F,d),v))return}else if(e.substring(O,D).trim()&&(w(te),v))return}if(M=e.charCodeAt(D+1),M===33){if(j=e.charCodeAt(D+2),j===91&&e.substr(D+3,6)===`CDATA[`){if(O=e.indexOf(`]]>`,D),O===-1)return o?e.substring(D):C(`unclosed cdata`);if(a&&(a(e.substring(D+9,O),d),v))return;O+=3;continue}if(j===45&&e.charCodeAt(D+3)===45){if(O=e.indexOf(`-->`,D),O===-1)return o?e.substring(D):C(`unclosed comment`);if(c&&(c(e.substring(D+4,O),F,d),v))return;O+=3;continue}}if(M===63){if(O=e.indexOf(`?>`,D),O===-1)return o?e.substring(D):C(`unclosed question`);if(l&&(l(e.substring(D,O+2),d),v))return;O+=2}else{for(k=D+1;;k++){if(ee=e.charCodeAt(k),isNaN(ee))return o?e.substring(D):(O=-1,C(`unclosed tag`));if(ee===34)j=e.indexOf(`"`,k+1),k=j===-1?k:j;else if(ee===39)j=e.indexOf(`'`,k+1),k=j===-1?k:j;else if(ee===62){O=k;break}}if(M===33){if(u&&(u(e.substring(D,O+1),F,d),v))return;O+=1}else{if(R={},M===47){if(T=!1,E=!0,!x.length)return C(`missing open tag`);if(k=P=x.pop(),j=D+2+k.length,e.substring(D+2,j)!==k)return C(`closing tag mismatch`);for(;j<O;j++)if(M=e.charCodeAt(j),!(M===32||M>8&&M<14))return C(`close tag`)}else{if(e.charCodeAt(O-1)===47?(k=P=e.substring(D+1,O-1),T=!0,E=!0):(k=P=e.substring(D+1,O),T=!0,E=!1),!(M>96&&M<123||M>64&&M<91||M===95||M===58))return C(`illegal first char nodeName`);for(j=1,A=k.length;j<A;j++)if(M=k.charCodeAt(j),!(M>96&&M<123||M>64&&M<91||M>47&&M<59||M===45||M===95||M==46)){if(M===32||M<14&&M>8){P=k.substring(0,j),R=null;break}return C(`invalid nodeName`)}E||x.push(P)}if(g){T&&(f=null,R===null&&(h=k.indexOf(`xmlns`,j)!==-1)&&(ce=j,L=k,z(),h=!1),E||y.push(f)),I=P,s===null&&(s=Object.create(null));var de=s[P];if(de!==void 0)P=de;else{if(M=P.indexOf(`:`),M!==-1){if(N=b[P.substring(0,M)],!N)return C(`missing namespace on <`+I+`>`);P=P.substr(M+1)}else N=b.xmlns;N&&(P=N+`:`+P),s[I]=P}}if(T&&(ce=j,L=k,r&&(t?r(se,F,E,d):r(P,z,F,E,d),v)))return;if(E){if(i&&(i(t?se:P,F,T,d),v))return;g&&(T||(f=y.pop()),f&&(ae(b,f),f=null,s=null,m=null))}O+=1}}}}}function le(e){return e.xml&&e.xml.tagAlias===`lowerCase`}var z={xsi:`http://www.w3.org/2001/XMLSchema-instance`,xml:`http://www.w3.org/XML/1998/namespace`},ue=`property`;function de(e){return e.xml&&e.xml.serialize}function fe(e){let t=de(e);return t!==ue&&(t||null)}function pe(e){return e.charAt(0).toUpperCase()+e.slice(1)}function me(e,t){return le(t)?e.prefix+`:`+pe(e.localName):e.name}function he(e,t){var n=e.name,r=e.localName,i=t&&t.xml&&t.xml.typePrefix;return i&&r.indexOf(i)===0?e.prefix+`:`+r.slice(i.length):n}function ge(e,t,n){let r=S(e,t.xmlns),i=S(`${t[r.prefix]||r.prefix}:${r.localName}`);return he(i,n.getPackage(i.prefix))}function B(e){return Error(e)}function V(e){return e.$descriptor}function _e(e){u(this,e),this.elementsById=Object.create(null),this.references=[],this.warnings=[],this.addReference=function(e){this.references.push(e)},this.addElement=function(e){if(!e)throw B(`expected element`);var t=this.elementsById,n=V(e).idProperty,r;if(n&&(r=e.get(n.name),r)){if(!/^([a-z][\w-.]*:)?[a-z_][\w-.]*$/i.test(r))throw Error(`illegal ID <`+r+`>`);if(t[r])throw B(`duplicate ID <`+r+`>`);t[r]=e}},this.addWarning=function(e){this.warnings.push(e)}}function ve(){}ve.prototype.handleEnd=function(){},ve.prototype.handleText=function(){},ve.prototype.handleNode=function(){};function ye(){}ye.prototype=Object.create(ve.prototype),ye.prototype.handleNode=function(){return this};function be(){}be.prototype=Object.create(ve.prototype),be.prototype.handleText=function(e){this.body=(this.body||``)+e};function xe(e,t){this.property=e,this.context=t}xe.prototype=Object.create(be.prototype),xe.prototype.handleNode=function(e){if(this.element)throw B(`expected no sub nodes`);return this.element=this.createReference(e),this},xe.prototype.handleEnd=function(){this.element.id=this.body},xe.prototype.createReference=function(e){return{property:this.property.ns.name,id:``}};function Se(e,t){this.element=t,this.propertyDesc=e}Se.prototype=Object.create(be.prototype),Se.prototype.handleEnd=function(){var e=this.body||``,t=this.element,n=this.propertyDesc;e=y(n.type,e),n.isMany?t.get(n.name).push(e):t.set(n.name,e)};function Ce(){}Ce.prototype=Object.create(be.prototype),Ce.prototype.handleNode=function(e){var t=this,n=this.element;return n?t=this.handleChild(e):(n=this.element=this.createElement(e),this.context.addElement(n)),t};function H(e,t,n){this.model=e,this.type=e.getType(t),this.context=n}H.prototype=Object.create(Ce.prototype),H.prototype.addReference=function(e){this.context.addReference(e)},H.prototype.handleText=function(e){var t=this.element;if(!V(t).bodyProperty)throw B(`unexpected body text <`+e+`>`);be.prototype.handleText.call(this,e)},H.prototype.handleEnd=function(){var e=this.body,t=this.element,n=V(t).bodyProperty;n&&e!==void 0&&(e=y(n.type,e),t.set(n.name,e))},H.prototype.createElement=function(e){var t=e.attributes,n=this.type,r=V(n),i=this.context,a=new n({}),s=this.model,c;return o(t,function(e,t){var n=r.propertiesByName[t],l;n&&n.isReference?n.isMany?(l=e.split(` `),o(l,function(e){i.addReference({element:a,property:n.ns.name,id:e})})):i.addReference({element:a,property:n.ns.name,id:e}):(n?e=y(n.type,e):t===`xmlns`?t=`:`+t:(c=S(t,r.ns.prefix),s.getPackage(c.prefix)&&i.addWarning({message:`unknown attribute <`+t+`>`,element:a,property:t,value:e})),a.set(t,e))}),a},H.prototype.getPropertyForNode=function(e){var t=e.name,n=S(t),r=this.type,i=this.model,a=V(r),o=n.name,s=a.propertiesByName[o];if(s&&!s.isAttr){let t=fe(s);if(t){let n=e.attributes[t];if(n){let t=ge(n,e.ns,i),r=i.getType(t);return u({},s,{effectiveType:V(r).name})}}return s}var l=i.getPackage(n.prefix);if(l){let e=me(n,l),t=i.getType(e);if(s=c(a.properties,function(e){return!e.isVirtual&&!e.isReference&&!e.isAttribute&&t.hasType(e.type)}),s)return u({},s,{effectiveType:V(t).name})}else if(s=c(a.properties,function(e){return!e.isReference&&!e.isAttribute&&e.type===`Element`}),s)return s;throw B(`unrecognized element <`+n.name+`>`)},H.prototype.toString=function(){return`ElementDescriptor[`+V(this.type).name+`]`},H.prototype.valueHandler=function(e,t){return new Se(e,t)},H.prototype.referenceHandler=function(e){return new xe(e,this.context)},H.prototype.handler=function(e){return e===`Element`?new Te(this.model,e,this.context):new H(this.model,e,this.context)},H.prototype.handleChild=function(e){var t=this.getPropertyForNode(e),n,r=this.element,i;if(n=t.effectiveType||t.type,x(n))return this.valueHandler(t,r);i=t.isReference?this.referenceHandler(t).handleNode(e):this.handler(n).handleNode(e);var a=i.element;return a!==void 0&&(t.isMany?r.get(t.name).push(a):r.set(t.name,a),t.isReference?(u(a,{element:r}),this.context.addReference(a)):a.$parent=r),i};function we(e,t,n){H.call(this,e,t,n)}we.prototype=Object.create(H.prototype),we.prototype.createElement=function(e){var t=e.name,n=S(t),r=this.model,i=this.type,a=r.getPackage(n.prefix),o=a&&me(n,a)||t;if(!i.hasType(o))throw B(`unexpected element <`+e.originalName+`>`);return H.prototype.createElement.call(this,e)};function Te(e,t,n){this.model=e,this.context=n}Te.prototype=Object.create(Ce.prototype),Te.prototype.createElement=function(e){var t=e.name,n=S(t).prefix,r=e.ns[n+`$uri`],i=e.attributes;return this.model.createAny(t,r,i)},Te.prototype.handleChild=function(e){var t=new Te(this.model,`Element`,this.context).handleNode(e),n=this.element,r=t.element,i;return r!==void 0&&(i=n.$children=n.$children||[],i.push(r),r.$parent=n),t},Te.prototype.handleEnd=function(){this.body&&(this.element.$body=this.body)};function Ee(e){e instanceof A&&(e={model:e}),u(this,{lax:!1},e)}Ee.prototype.fromXML=function(e,t,n){var r=t.rootHandler;t instanceof H?(r=t,t={}):typeof t==`string`?(r=this.handler(t),t={}):typeof r==`string`&&(r=this.handler(r));var i=this.model,a=this.lax,o=new _e(u({},t,{rootHandler:r})),s=new R({proxy:!0}),c=De();r.context=o,c.push(r);function l(e,t,n){var r=t(),i=r.line,a=r.column,s=r.data;s.charAt(0)===`<`&&s.indexOf(` `)!==-1&&(s=s.slice(0,s.indexOf(` `))+`>`);var c=`unparsable content `+(s?s+` `:``)+`detected
	line: `+i+`
	column: `+a+`
	nested error: `+e.message;if(n)return o.addWarning({message:c,error:e}),!0;throw B(c)}function d(e,t){return l(e,t,!0)}function f(){for(var e=o.elementsById,t=o.references,n=0,r;r=t[n];n++){var i=r.element,a=e[r.id],s=V(i).propertiesByName[r.property];if(a||o.addWarning({message:`unresolved reference <`+r.id+`>`,element:r.element,property:r.property,value:r.id}),s.isMany){var c=i.get(s.name),l=c.indexOf(r);l===-1&&(l=c.length),a?c[l]=a:c.splice(l,1)}else i.set(s.name,a)}}function p(){c.pop().handleEnd()}var m=/^<\?xml /i,h=/ encoding="([^"]+)"/i,g=/^utf-8$/i;function _(e){if(m.test(e)){var t=h.exec(e),n=t&&t[1];n&&!g.test(n)&&o.addWarning({message:`unsupported document encoding <`+n+`>, falling back to UTF-8`})}}function v(e,t){var n=c.peek();try{c.push(n.handleNode(e))}catch(e){l(e,t,a)&&c.push(new ye)}}function y(e,t){try{c.peek().handleText(e)}catch(e){d(e,t)}}function b(e,t){e.trim()&&y(e,t)}var x=i.getPackages().reduce(function(e,t){return e[t.uri]=t.prefix,e},Object.entries(z).reduce(function(e,[t,n]){return e[n]=t,e},i.config&&i.config.nsMap||{}));return s.ns(x).on(`openTag`,function(e,t,n,r){var i=e.attrs||{},a=Object.keys(i).reduce(function(e,n){return e[n]=t(i[n]),e},{});v({name:e.name,originalName:e.originalName,attributes:a,ns:e.ns},r)}).on(`question`,_).on(`closeTag`,p).on(`cdata`,y).on(`text`,function(e,t,n){b(t(e),n)}).on(`error`,l).on(`warn`,d),new Promise(function(t,n){var i;try{s.parse(e),f()}catch(e){i=e}var a=r.element;!i&&!a&&(i=B(`failed to parse document as <`+r.type.$descriptor.name+`>`));var c=o.warnings,l=o.references,u=o.elementsById;return i?(i.warnings=c,n(i)):t({rootElement:a,elementsById:u,references:l,warnings:c})})},Ee.prototype.handler=function(e){return new we(this.model,e)};function De(){var e=[];return Object.defineProperty(e,"peek",{value:function(){return this[this.length-1]}}),e}var Oe=`<?xml version="1.0" encoding="UTF-8"?>
`,ke=/<|>|'|"|&|\n\r|\n/g,Ae=/<|>|&/g;function U(e){this.prefixMap={},this.uriMap={},this.used={},this.wellknown=[],this.custom=[],this.parent=e,this.defaultPrefixMap=e&&e.defaultPrefixMap||{}}U.prototype.mapDefaultPrefixes=function(e){this.defaultPrefixMap=e},U.prototype.defaultUriByPrefix=function(e){return this.defaultPrefixMap[e]},U.prototype.resolve=function(e){for(var t=this;t;){var n=e(t);if(n)return n;t=t.parent}},U.prototype.eachScope=function(e){for(var t=this;t;)e(t),t=t.parent},U.prototype.byUri=function(e){return this.resolve(function(t){return t.uriMap[e]})},U.prototype.add=function(e,t){this.uriMap[e.uri]=e,t?this.wellknown.push(e):this.custom.push(e),this.mapPrefix(e.prefix,e.uri)},U.prototype.uriByPrefix=function(e){var t=e||`xmlns`;return this.resolve(function(e){return e.prefixMap[t]})},U.prototype.mapPrefix=function(e,t){this.prefixMap[e||`xmlns`]=t},U.prototype.getNSKey=function(e){return e.prefix===void 0?e.uri:e.uri+`|`+e.prefix},U.prototype.logUsed=function(e){var t=e.uri,n=this.getNSKey(e),r=this.byUri(t);this.eachScope(function(e){e.used[n]=r})},U.prototype.getUsed=function(e){return[].concat(this.wellknown,this.custom).filter(e=>{var t=this.getNSKey(e);return this.used[t]})};function je(e){return e.charAt(0).toLowerCase()+e.slice(1)}function Me(e,t){return le(t)?je(e):e}function Ne(e,t){e.super_=t,e.prototype=Object.create(t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}})}function Pe(e){return d(e)?e:(e.prefix?e.prefix+`:`:``)+e.localName}function Fe(e){return e.getUsed().filter(function(e){return e.prefix!==`xml`}).map(function(e){return{name:`xmlns`+(e.prefix?`:`+e.prefix:``),value:He(e.uri)}})}function Ie(e,t){return t.isGeneric?u({localName:t.ns.localName},e):u({localName:Me(t.ns.localName,t.$pkg)},e)}function Le(e,t){return u({localName:t.ns.localName},e)}function Re(e){var t=e.$descriptor;return r(t.properties,function(t){var n=t.name;if(t.isVirtual||!i(e,n))return!1;var r=e[n];return r===t.default||r===null?!1:!t.isMany||r.length})}var ze={"\n":`#10`,"\n\r":`#10`,'"':`#34`,"'":`#39`,"<":`#60`,">":`#62`,"&":`#38`},Be={"<":`lt`,">":`gt`,"&":`amp`};function Ve(e,t,n){return e=d(e)?e:``+e,e.replace(t,function(e){return`&`+n[e]+`;`})}function He(e){return Ve(e,ke,ze)}function Ue(e){return Ve(e,Ae,Be)}function We(e){return r(e,function(e){return e.isAttr})}function Ge(e){return r(e,function(e){return!e.isAttr})}function Ke(e){this.tagName=e}Ke.prototype.build=function(e){return this.element=e,this},Ke.prototype.serializeTo=function(e){e.appendIndent().append(`<`+this.tagName+`>`+Ue(this.element.id)+`</`+this.tagName+`>`).appendNewLine()};function W(){}W.prototype.serializeValue=W.prototype.serializeTo=function(e){e.append(this.escape?Ue(this.value):this.value)},W.prototype.build=function(e,t){return this.value=t,e.type===`String`&&t.search(Ae)!==-1&&(this.escape=!0),this};function qe(e){this.tagName=e}Ne(qe,W),qe.prototype.serializeTo=function(e){e.appendIndent().append(`<`+this.tagName+`>`),this.serializeValue(e),e.append(`</`+this.tagName+`>`).appendNewLine()};function G(e,t){this.body=[],this.attrs=[],this.parent=e,this.propertyDescriptor=t}G.prototype.build=function(e){return $e(this,e),this},G.prototype.enter=function(e){this.element=e;var t=e.$descriptor,n=this.propertyDescriptor,r=t.isGeneric;if(this.otherAttrs=r?this.parseGenericNsAttributes(e):this.parseNsAttributes(e),this.ns=n?this.nsPropertyTagName(n):this.nsTagName(t),this.tagName=this.addTagName(this.ns),r)return this.collectGenericContainments(e);var i=Re(e);return this.parseAttributes(We(i)),this.collectContainments(Ge(i))},G.prototype.exit=function(){this.parseGenericAttributes(this.element,this.otherAttrs)},G.prototype.nsTagName=function(e){return Ie(this.logNamespaceUsed(e.ns),e)},G.prototype.nsPropertyTagName=function(e){return Le(this.logNamespaceUsed(e.ns),e)},G.prototype.isLocalNs=function(e){return e.uri===this.ns.uri},G.prototype.nsAttributeName=function(e){var t=d(e)?S(e):e.ns;if(e.inherited)return{localName:t.localName};var n=this.logNamespaceUsed(t);return this.getNamespaces().logUsed(n),this.isLocalNs(n)?{localName:t.localName}:u({localName:t.localName},n)},G.prototype.parseGenericNsAttributes=function(e){return Object.entries(e).filter(([t,n])=>!t.startsWith(`$`)&&this.parseNsAttribute(e,t,n)).map(([e,t])=>({name:e,value:t}))},G.prototype.collectGenericContainments=function(e){var t=this,n=[],r=e.$body;r&&n.push({create:function(){return new W().build({type:`String`},r)}});var i=e.$children;return i&&o(i,function(e){n.push({create:function(){return new G(t)},element:e})}),n},G.prototype.parseNsAttribute=function(e,t,n){var r=e.$model,i=S(t),a;if(i.prefix===`xmlns`&&(a={prefix:i.localName,uri:n}),!i.prefix&&i.localName===`xmlns`&&(a={uri:n}),!a)return{name:t,value:n};if(r&&r.getPackage(n))this.logNamespace(a,!0,!0);else{var o=this.logNamespaceUsed(a,!0);this.getNamespaces().logUsed(o)}},G.prototype.parseNsAttributes=function(e){var t=this,n=e.$attrs,r=[];return o(n,function(n,i){var a=t.parseNsAttribute(e,i,n);a&&r.push(a)}),r},G.prototype.parseGenericAttributes=function(e,t){var n=this;o(t,function(t){try{n.addAttribute(n.nsAttributeName(t.name),t.value)}catch(n){typeof console<`u`&&console.warn(`missing namespace information for <${t.name}=${t.value}> on`,e,n)}})},G.prototype.collectContainments=function(e){var t=this,n=this.element,r=[];return o(e,function(e){var i=n.get(e.name),a=e.isReference;if(e.isMany||(i=[i]),e.isBody)r.push({create:function(){return new W().build(e,i[0])}});else if(x(e.type))o(i,function(n){r.push({create:function(){return new qe(t.addTagName(t.nsPropertyTagName(e))).build(e,n)}})});else if(a)o(i,function(n){r.push({create:function(){return new Ke(t.addTagName(t.nsPropertyTagName(e))).build(n)}})});else{var s=de(e);o(i,function(n){r.push({create:function(){return s?s===ue?new G(t,e):new Ye(t,e,s):new G(t)},element:n})})}}),r},G.prototype.getNamespaces=function(e){var t=this.namespaces;if(!t){var n=this.getParentNamespaces();e||!n?this.namespaces=t=new U(n):t=n}return t},G.prototype.getParentNamespaces=function(){if(this.parentNamespaces!==void 0)return this.parentNamespaces;for(var e=null,t=this.parent;t;){if(t.namespaces){e=t.namespaces;break}if(t.parentNamespaces!==void 0){e=t.parentNamespaces;break}t=t.parent}return this.parentNamespaces=e},G.prototype.logNamespace=function(e,t,n){var r=this.getNamespaces(n),i=e.uri,a=e.prefix;return(!r.byUri(i)||n)&&r.add(e,t),r.mapPrefix(a,i),e},G.prototype.logNamespaceUsed=function(e,t){var n=this.getNamespaces(t),r=e.prefix,i=e.uri,a,o,s;if(!r&&!i)return{localName:e.localName};if(s=n.defaultUriByPrefix(r),i=i||s||n.uriByPrefix(r),!i)throw Error(`no namespace uri given for prefix <`+r+`>`);if(e=n.byUri(i),!e&&!r&&(e=this.logNamespace({uri:i},s===i,!0)),!e){for(a=r,o=1;n.uriByPrefix(a);)a=r+`_`+o++;e=this.logNamespace({prefix:a,uri:i},s===i)}return r&&n.mapPrefix(r,i),e},G.prototype.parseAttributes=function(e){var t=this,n=this.element;o(e,function(e){var r=n.get(e.name);if(e.isReference){if(!e.isMany)r=r.id;else{var i=[];o(r,function(e){i.push(e.id)}),r=i.join(` `)}}t.addAttribute(t.nsAttributeName(e),r)})},G.prototype.addTagName=function(e){var t=this.logNamespaceUsed(e);return this.getNamespaces().logUsed(t),Pe(e)},G.prototype.addAttribute=function(e,t){var n=this.attrs;d(t)&&(t=He(t));var r=l(n,function(t){return t.name.localName===e.localName&&t.name.uri===e.uri&&t.name.prefix===e.prefix}),i={name:e,value:t};r===-1?n.push(i):n.splice(r,1,i)},G.prototype.serializeAttributes=function(e){var t=this.attrs,n=this.namespaces;n&&(t=Fe(n).concat(t)),o(t,function(t){e.append(` `).append(Pe(t.name)).append(`="`).append(t.value).append(`"`)})},G.prototype.serializeTo=function(e){Je(this,e)};function Je(e,t){for(var n=[{serializer:e,index:0,opened:!1,indent:!1}];n.length;){var r=n[n.length-1],i=r.serializer;if(!r.opened){var a=i.body[0];if(r.indent=a&&a.constructor!==W,t.appendIndent().append(`<`+i.tagName),i.serializeAttributes(t),t.append(a?`>`:` />`),r.opened=!0,!a){t.appendNewLine(),n.pop();continue}r.indent&&t.appendNewLine().indent()}if(r.index<i.body.length){var o=i.body[r.index++];o instanceof G?n.push({serializer:o,index:0,opened:!1,indent:!1}):o.serializeTo(t)}else r.indent&&t.unindent().appendIndent(),t.append(`</`+i.tagName+`>`).appendNewLine(),n.pop()}}function Ye(e,t,n){G.call(this,e,t),this.serialization=n}Ne(Ye,G),Ye.prototype.parseNsAttributes=function(e){var t=G.prototype.parseNsAttributes.call(this,e).filter(e=>e.name!==this.serialization),n=e.$descriptor;if(n.name===this.propertyDescriptor.type)return t;var r=this.typeNs=this.nsTagName(n);this.getNamespaces().logUsed(this.typeNs);var i=e.$model.getPackage(r.uri),a=i.xml&&i.xml.typePrefix||``;return this.addAttribute(this.nsAttributeName(this.serialization),(r.prefix?r.prefix+`:`:``)+a+n.ns.localName),t},Ye.prototype.isLocalNs=function(e){return e.uri===(this.typeNs||this.ns).uri};function Xe(){this.value=``,this.write=function(e){this.value+=e}}function Ze(e,t){var n=[``];this.append=function(t){return e.write(t),this},this.appendNewLine=function(){return t&&e.write(`
`),this},this.appendIndent=function(){return t&&e.write(n.join(`  `)),this},this.indent=function(){return n.push(``),this},this.unindent=function(){return n.pop(),this}}function Qe(e){e=u({format:!1,preamble:!0},e||{});function t(t,n){var r=n||new Xe,i=new Ze(r,e.format);e.preamble&&i.append(Oe);var a=new G,o=t.$model;if(a.getNamespaces().mapDefaultPrefixes(et(o)),a.build(t).serializeTo(i),!n)return r.value}return{toXML:t}}function $e(e,t){for(var n=[{serializer:e,children:e.enter(t),index:0}];n.length;){var r=n[n.length-1];if(r.index>=r.children.length)r.serializer.exit(),n.pop();else{var i=r.children[r.index++],a=i.create();r.serializer.body.push(a),i.element&&n.push({serializer:a,children:a.enter(i.element),index:0})}}}function et(e){let t=e.config&&e.config.nsMap||{},n={};for(let e in z)n[e]=z[e];for(let e in t){let r=t[e];n[r]=e}for(let t of e.getPackages())n[t.prefix]=t.uri;return n}function tt(e,t){A.call(this,e,t)}tt.prototype=Object.create(A.prototype),tt.prototype.fromXML=function(e,t,n){d(t)||(n=t,t=`bpmn:Definitions`);var r=new Ee(u({model:this,lax:!0},n)),i=r.handler(t);return r.fromXML(e,i)},tt.prototype.toXML=function(e,t){var n=new Qe(t);return new Promise(function(t,r){try{return t({xml:n.toXML(e)})}catch(e){return r(e)}})};var nt={bpmn:{name:`BPMN20`,uri:`http://www.omg.org/spec/BPMN/20100524/MODEL`,prefix:`bpmn`,associations:[],types:[{name:`Interface`,superClass:[`RootElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`operations`,type:`Operation`,isMany:!0},{name:`implementationRef`,isAttr:!0,type:`String`}]},{name:`Operation`,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`inMessageRef`,type:`Message`,isReference:!0},{name:`outMessageRef`,type:`Message`,isReference:!0},{name:`errorRef`,type:`Error`,isMany:!0,isReference:!0},{name:`implementationRef`,isAttr:!0,type:`String`}]},{name:`EndPoint`,superClass:[`RootElement`]},{name:`Auditing`,superClass:[`BaseElement`]},{name:`GlobalTask`,superClass:[`CallableElement`],properties:[{name:`resources`,type:`ResourceRole`,isMany:!0}]},{name:`Monitoring`,superClass:[`BaseElement`]},{name:`Performer`,superClass:[`ResourceRole`]},{name:`Process`,superClass:[`FlowElementsContainer`,`CallableElement`],properties:[{name:`processType`,type:`ProcessType`,isAttr:!0},{name:`isClosed`,isAttr:!0,type:`Boolean`},{name:`auditing`,type:`Auditing`},{name:`monitoring`,type:`Monitoring`},{name:`properties`,type:`Property`,isMany:!0},{name:`laneSets`,isMany:!0,replaces:`FlowElementsContainer#laneSets`,type:`LaneSet`},{name:`flowElements`,isMany:!0,replaces:`FlowElementsContainer#flowElements`,type:`FlowElement`},{name:`artifacts`,type:`Artifact`,isMany:!0},{name:`resources`,type:`ResourceRole`,isMany:!0},{name:`correlationSubscriptions`,type:`CorrelationSubscription`,isMany:!0},{name:`supports`,type:`Process`,isMany:!0,isReference:!0},{name:`definitionalCollaborationRef`,type:`Collaboration`,isAttr:!0,isReference:!0},{name:`isExecutable`,isAttr:!0,type:`Boolean`}]},{name:`LaneSet`,superClass:[`BaseElement`],properties:[{name:`lanes`,type:`Lane`,isMany:!0},{name:`name`,isAttr:!0,type:`String`}]},{name:`Lane`,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`partitionElementRef`,type:`BaseElement`,isAttr:!0,isReference:!0},{name:`partitionElement`,type:`BaseElement`},{name:`flowNodeRef`,type:`FlowNode`,isMany:!0,isReference:!0},{name:`childLaneSet`,type:`LaneSet`,xml:{serialize:`xsi:type`}}]},{name:`GlobalManualTask`,superClass:[`GlobalTask`]},{name:`ManualTask`,superClass:[`Task`]},{name:`UserTask`,superClass:[`Task`],properties:[{name:`renderings`,type:`Rendering`,isMany:!0},{name:`implementation`,isAttr:!0,type:`String`}]},{name:`Rendering`,superClass:[`BaseElement`]},{name:`HumanPerformer`,superClass:[`Performer`]},{name:`PotentialOwner`,superClass:[`HumanPerformer`]},{name:`GlobalUserTask`,superClass:[`GlobalTask`],properties:[{name:`implementation`,isAttr:!0,type:`String`},{name:`renderings`,type:`Rendering`,isMany:!0}]},{name:`Gateway`,isAbstract:!0,superClass:[`FlowNode`],properties:[{name:`gatewayDirection`,type:`GatewayDirection`,default:`Unspecified`,isAttr:!0}]},{name:`EventBasedGateway`,superClass:[`Gateway`],properties:[{name:`instantiate`,default:!1,isAttr:!0,type:`Boolean`},{name:`eventGatewayType`,type:`EventBasedGatewayType`,isAttr:!0,default:`Exclusive`}]},{name:`ComplexGateway`,superClass:[`Gateway`],properties:[{name:`activationCondition`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`default`,type:`SequenceFlow`,isAttr:!0,isReference:!0}]},{name:`ExclusiveGateway`,superClass:[`Gateway`],properties:[{name:`default`,type:`SequenceFlow`,isAttr:!0,isReference:!0}]},{name:`InclusiveGateway`,superClass:[`Gateway`],properties:[{name:`default`,type:`SequenceFlow`,isAttr:!0,isReference:!0}]},{name:`ParallelGateway`,superClass:[`Gateway`]},{name:`RootElement`,isAbstract:!0,superClass:[`BaseElement`]},{name:`Relationship`,superClass:[`BaseElement`],properties:[{name:`type`,isAttr:!0,type:`String`},{name:`direction`,type:`RelationshipDirection`,isAttr:!0},{name:`source`,isMany:!0,isReference:!0,type:`Element`},{name:`target`,isMany:!0,isReference:!0,type:`Element`}]},{name:`BaseElement`,isAbstract:!0,properties:[{name:`id`,isAttr:!0,type:`String`,isId:!0},{name:`documentation`,type:`Documentation`,isMany:!0},{name:`extensionDefinitions`,type:`ExtensionDefinition`,isMany:!0,isReference:!0},{name:`extensionElements`,type:`ExtensionElements`}]},{name:`Extension`,properties:[{name:`mustUnderstand`,default:!1,isAttr:!0,type:`Boolean`},{name:`definition`,type:`ExtensionDefinition`,isAttr:!0,isReference:!0}]},{name:`ExtensionDefinition`,properties:[{name:`name`,isAttr:!0,type:`String`},{name:`extensionAttributeDefinitions`,type:`ExtensionAttributeDefinition`,isMany:!0}]},{name:`ExtensionAttributeDefinition`,properties:[{name:`name`,isAttr:!0,type:`String`},{name:`type`,isAttr:!0,type:`String`},{name:`isReference`,default:!1,isAttr:!0,type:`Boolean`},{name:`extensionDefinition`,type:`ExtensionDefinition`,isAttr:!0,isReference:!0}]},{name:`ExtensionElements`,properties:[{name:`valueRef`,isAttr:!0,isReference:!0,type:`Element`},{name:`values`,type:`Element`,isMany:!0},{name:`extensionAttributeDefinition`,type:`ExtensionAttributeDefinition`,isAttr:!0,isReference:!0}]},{name:`Documentation`,superClass:[`BaseElement`],properties:[{name:`text`,type:`String`,isBody:!0},{name:`textFormat`,default:`text/plain`,isAttr:!0,type:`String`}]},{name:`Event`,isAbstract:!0,superClass:[`FlowNode`,`InteractionNode`],properties:[{name:`properties`,type:`Property`,isMany:!0}]},{name:`IntermediateCatchEvent`,superClass:[`CatchEvent`]},{name:`IntermediateThrowEvent`,superClass:[`ThrowEvent`]},{name:`EndEvent`,superClass:[`ThrowEvent`]},{name:`StartEvent`,superClass:[`CatchEvent`],properties:[{name:`isInterrupting`,default:!0,isAttr:!0,type:`Boolean`}]},{name:`ThrowEvent`,isAbstract:!0,superClass:[`Event`],properties:[{name:`dataInputs`,type:`DataInput`,isMany:!0},{name:`dataInputAssociations`,type:`DataInputAssociation`,isMany:!0},{name:`inputSet`,type:`InputSet`},{name:`eventDefinitions`,type:`EventDefinition`,isMany:!0},{name:`eventDefinitionRef`,type:`EventDefinition`,isMany:!0,isReference:!0}]},{name:`CatchEvent`,isAbstract:!0,superClass:[`Event`],properties:[{name:`parallelMultiple`,isAttr:!0,type:`Boolean`,default:!1},{name:`dataOutputs`,type:`DataOutput`,isMany:!0},{name:`dataOutputAssociations`,type:`DataOutputAssociation`,isMany:!0},{name:`outputSet`,type:`OutputSet`},{name:`eventDefinitions`,type:`EventDefinition`,isMany:!0},{name:`eventDefinitionRef`,type:`EventDefinition`,isMany:!0,isReference:!0}]},{name:`BoundaryEvent`,superClass:[`CatchEvent`],properties:[{name:`cancelActivity`,default:!0,isAttr:!0,type:`Boolean`},{name:`attachedToRef`,type:`Activity`,isAttr:!0,isReference:!0}]},{name:`EventDefinition`,isAbstract:!0,superClass:[`RootElement`]},{name:`CancelEventDefinition`,superClass:[`EventDefinition`]},{name:`ErrorEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`errorRef`,type:`Error`,isAttr:!0,isReference:!0}]},{name:`TerminateEventDefinition`,superClass:[`EventDefinition`]},{name:`EscalationEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`escalationRef`,type:`Escalation`,isAttr:!0,isReference:!0}]},{name:`Escalation`,properties:[{name:`structureRef`,type:`ItemDefinition`,isAttr:!0,isReference:!0},{name:`name`,isAttr:!0,type:`String`},{name:`escalationCode`,isAttr:!0,type:`String`}],superClass:[`RootElement`]},{name:`CompensateEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`waitForCompletion`,isAttr:!0,type:`Boolean`,default:!0},{name:`activityRef`,type:`Activity`,isAttr:!0,isReference:!0}]},{name:`TimerEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`timeDate`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`timeCycle`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`timeDuration`,type:`Expression`,xml:{serialize:`xsi:type`}}]},{name:`LinkEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`target`,type:`LinkEventDefinition`,isReference:!0},{name:`source`,type:`LinkEventDefinition`,isMany:!0,isReference:!0}]},{name:`MessageEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`messageRef`,type:`Message`,isAttr:!0,isReference:!0},{name:`operationRef`,type:`Operation`,isReference:!0}]},{name:`ConditionalEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`condition`,type:`Expression`,xml:{serialize:`xsi:type`}}]},{name:`SignalEventDefinition`,superClass:[`EventDefinition`],properties:[{name:`signalRef`,type:`Signal`,isAttr:!0,isReference:!0}]},{name:`Signal`,superClass:[`RootElement`],properties:[{name:`structureRef`,type:`ItemDefinition`,isAttr:!0,isReference:!0},{name:`name`,isAttr:!0,type:`String`}]},{name:`ImplicitThrowEvent`,superClass:[`ThrowEvent`]},{name:`DataState`,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`}]},{name:`ItemAwareElement`,superClass:[`BaseElement`],properties:[{name:`itemSubjectRef`,type:`ItemDefinition`,isAttr:!0,isReference:!0},{name:`dataState`,type:`DataState`}]},{name:`DataAssociation`,superClass:[`BaseElement`],properties:[{name:`sourceRef`,type:`ItemAwareElement`,isMany:!0,isReference:!0},{name:`targetRef`,type:`ItemAwareElement`,isReference:!0},{name:`transformation`,type:`FormalExpression`,xml:{serialize:`property`}},{name:`assignment`,type:`Assignment`,isMany:!0}]},{name:`DataInput`,superClass:[`ItemAwareElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`isCollection`,default:!1,isAttr:!0,type:`Boolean`},{name:`inputSetRef`,type:`InputSet`,isMany:!0,isVirtual:!0,isReference:!0},{name:`inputSetWithOptional`,type:`InputSet`,isMany:!0,isVirtual:!0,isReference:!0},{name:`inputSetWithWhileExecuting`,type:`InputSet`,isMany:!0,isVirtual:!0,isReference:!0}]},{name:`DataOutput`,superClass:[`ItemAwareElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`isCollection`,default:!1,isAttr:!0,type:`Boolean`},{name:`outputSetRef`,type:`OutputSet`,isMany:!0,isVirtual:!0,isReference:!0},{name:`outputSetWithOptional`,type:`OutputSet`,isMany:!0,isVirtual:!0,isReference:!0},{name:`outputSetWithWhileExecuting`,type:`OutputSet`,isMany:!0,isVirtual:!0,isReference:!0}]},{name:`InputSet`,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`dataInputRefs`,type:`DataInput`,isMany:!0,isReference:!0},{name:`optionalInputRefs`,type:`DataInput`,isMany:!0,isReference:!0},{name:`whileExecutingInputRefs`,type:`DataInput`,isMany:!0,isReference:!0},{name:`outputSetRefs`,type:`OutputSet`,isMany:!0,isReference:!0}]},{name:`OutputSet`,superClass:[`BaseElement`],properties:[{name:`dataOutputRefs`,type:`DataOutput`,isMany:!0,isReference:!0},{name:`name`,isAttr:!0,type:`String`},{name:`inputSetRefs`,type:`InputSet`,isMany:!0,isReference:!0},{name:`optionalOutputRefs`,type:`DataOutput`,isMany:!0,isReference:!0},{name:`whileExecutingOutputRefs`,type:`DataOutput`,isMany:!0,isReference:!0}]},{name:`Property`,superClass:[`ItemAwareElement`],properties:[{name:`name`,isAttr:!0,type:`String`}]},{name:`DataInputAssociation`,superClass:[`DataAssociation`]},{name:`DataOutputAssociation`,superClass:[`DataAssociation`]},{name:`InputOutputSpecification`,superClass:[`BaseElement`],properties:[{name:`dataInputs`,type:`DataInput`,isMany:!0},{name:`dataOutputs`,type:`DataOutput`,isMany:!0},{name:`inputSets`,type:`InputSet`,isMany:!0},{name:`outputSets`,type:`OutputSet`,isMany:!0}]},{name:`DataObject`,superClass:[`FlowElement`,`ItemAwareElement`],properties:[{name:`isCollection`,default:!1,isAttr:!0,type:`Boolean`}]},{name:`InputOutputBinding`,properties:[{name:`inputDataRef`,type:`InputSet`,isAttr:!0,isReference:!0},{name:`outputDataRef`,type:`OutputSet`,isAttr:!0,isReference:!0},{name:`operationRef`,type:`Operation`,isAttr:!0,isReference:!0}]},{name:`Assignment`,superClass:[`BaseElement`],properties:[{name:`from`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`to`,type:`Expression`,xml:{serialize:`xsi:type`}}]},{name:`DataStore`,superClass:[`RootElement`,`ItemAwareElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`capacity`,isAttr:!0,type:`Integer`},{name:`isUnlimited`,default:!0,isAttr:!0,type:`Boolean`}]},{name:`DataStoreReference`,superClass:[`ItemAwareElement`,`FlowElement`],properties:[{name:`dataStoreRef`,type:`DataStore`,isAttr:!0,isReference:!0}]},{name:`DataObjectReference`,superClass:[`ItemAwareElement`,`FlowElement`],properties:[{name:`dataObjectRef`,type:`DataObject`,isAttr:!0,isReference:!0}]},{name:`ConversationLink`,superClass:[`BaseElement`],properties:[{name:`sourceRef`,type:`InteractionNode`,isAttr:!0,isReference:!0},{name:`targetRef`,type:`InteractionNode`,isAttr:!0,isReference:!0},{name:`name`,isAttr:!0,type:`String`}]},{name:`ConversationAssociation`,superClass:[`BaseElement`],properties:[{name:`innerConversationNodeRef`,type:`ConversationNode`,isAttr:!0,isReference:!0},{name:`outerConversationNodeRef`,type:`ConversationNode`,isAttr:!0,isReference:!0}]},{name:`CallConversation`,superClass:[`ConversationNode`],properties:[{name:`calledCollaborationRef`,type:`Collaboration`,isAttr:!0,isReference:!0},{name:`participantAssociations`,type:`ParticipantAssociation`,isMany:!0}]},{name:`Conversation`,superClass:[`ConversationNode`]},{name:`SubConversation`,superClass:[`ConversationNode`],properties:[{name:`conversationNodes`,type:`ConversationNode`,isMany:!0}]},{name:`ConversationNode`,isAbstract:!0,superClass:[`InteractionNode`,`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`participantRef`,type:`Participant`,isMany:!0,isReference:!0},{name:`messageFlowRefs`,type:`MessageFlow`,isMany:!0,isReference:!0},{name:`correlationKeys`,type:`CorrelationKey`,isMany:!0}]},{name:`GlobalConversation`,superClass:[`Collaboration`]},{name:`PartnerEntity`,superClass:[`RootElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`participantRef`,type:`Participant`,isMany:!0,isReference:!0}]},{name:`PartnerRole`,superClass:[`RootElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`participantRef`,type:`Participant`,isMany:!0,isReference:!0}]},{name:`CorrelationProperty`,superClass:[`RootElement`],properties:[{name:`correlationPropertyRetrievalExpression`,type:`CorrelationPropertyRetrievalExpression`,isMany:!0},{name:`name`,isAttr:!0,type:`String`},{name:`type`,type:`ItemDefinition`,isAttr:!0,isReference:!0}]},{name:`Error`,superClass:[`RootElement`],properties:[{name:`structureRef`,type:`ItemDefinition`,isAttr:!0,isReference:!0},{name:`name`,isAttr:!0,type:`String`},{name:`errorCode`,isAttr:!0,type:`String`}]},{name:`CorrelationKey`,superClass:[`BaseElement`],properties:[{name:`correlationPropertyRef`,type:`CorrelationProperty`,isMany:!0,isReference:!0},{name:`name`,isAttr:!0,type:`String`}]},{name:`Expression`,superClass:[`BaseElement`],isAbstract:!1,properties:[{name:`body`,isBody:!0,type:`String`}]},{name:`FormalExpression`,superClass:[`Expression`],properties:[{name:`language`,isAttr:!0,type:`String`},{name:`evaluatesToTypeRef`,type:`ItemDefinition`,isAttr:!0,isReference:!0}]},{name:`Message`,superClass:[`RootElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`itemRef`,type:`ItemDefinition`,isAttr:!0,isReference:!0}]},{name:`ItemDefinition`,superClass:[`RootElement`],properties:[{name:`itemKind`,type:`ItemKind`,isAttr:!0},{name:`structureRef`,isAttr:!0,type:`String`},{name:`isCollection`,default:!1,isAttr:!0,type:`Boolean`},{name:`import`,type:`Import`,isAttr:!0,isReference:!0}]},{name:`FlowElement`,isAbstract:!0,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`auditing`,type:`Auditing`},{name:`monitoring`,type:`Monitoring`},{name:`categoryValueRef`,type:`CategoryValue`,isMany:!0,isReference:!0}]},{name:`SequenceFlow`,superClass:[`FlowElement`],properties:[{name:`isImmediate`,isAttr:!0,type:`Boolean`},{name:`conditionExpression`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`sourceRef`,type:`FlowNode`,isAttr:!0,isReference:!0},{name:`targetRef`,type:`FlowNode`,isAttr:!0,isReference:!0}]},{name:`FlowElementsContainer`,isAbstract:!0,superClass:[`BaseElement`],properties:[{name:`laneSets`,type:`LaneSet`,isMany:!0},{name:`flowElements`,type:`FlowElement`,isMany:!0}]},{name:`CallableElement`,isAbstract:!0,superClass:[`RootElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`ioSpecification`,type:`InputOutputSpecification`,xml:{serialize:`property`}},{name:`supportedInterfaceRef`,type:`Interface`,isMany:!0,isReference:!0},{name:`ioBinding`,type:`InputOutputBinding`,isMany:!0,xml:{serialize:`property`}}]},{name:`FlowNode`,isAbstract:!0,superClass:[`FlowElement`],properties:[{name:`incoming`,type:`SequenceFlow`,isMany:!0,isReference:!0},{name:`outgoing`,type:`SequenceFlow`,isMany:!0,isReference:!0},{name:`lanes`,type:`Lane`,isMany:!0,isVirtual:!0,isReference:!0}]},{name:`CorrelationPropertyRetrievalExpression`,superClass:[`BaseElement`],properties:[{name:`messagePath`,type:`FormalExpression`},{name:`messageRef`,type:`Message`,isAttr:!0,isReference:!0}]},{name:`CorrelationPropertyBinding`,superClass:[`BaseElement`],properties:[{name:`dataPath`,type:`FormalExpression`},{name:`correlationPropertyRef`,type:`CorrelationProperty`,isAttr:!0,isReference:!0}]},{name:`Resource`,superClass:[`RootElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`resourceParameters`,type:`ResourceParameter`,isMany:!0}]},{name:`ResourceParameter`,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`isRequired`,isAttr:!0,type:`Boolean`},{name:`type`,type:`ItemDefinition`,isAttr:!0,isReference:!0}]},{name:`CorrelationSubscription`,superClass:[`BaseElement`],properties:[{name:`correlationKeyRef`,type:`CorrelationKey`,isAttr:!0,isReference:!0},{name:`correlationPropertyBinding`,type:`CorrelationPropertyBinding`,isMany:!0}]},{name:`MessageFlow`,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`sourceRef`,type:`InteractionNode`,isAttr:!0,isReference:!0},{name:`targetRef`,type:`InteractionNode`,isAttr:!0,isReference:!0},{name:`messageRef`,type:`Message`,isAttr:!0,isReference:!0}]},{name:`MessageFlowAssociation`,superClass:[`BaseElement`],properties:[{name:`innerMessageFlowRef`,type:`MessageFlow`,isAttr:!0,isReference:!0},{name:`outerMessageFlowRef`,type:`MessageFlow`,isAttr:!0,isReference:!0}]},{name:`InteractionNode`,isAbstract:!0,properties:[{name:`incomingConversationLinks`,type:`ConversationLink`,isMany:!0,isVirtual:!0,isReference:!0},{name:`outgoingConversationLinks`,type:`ConversationLink`,isMany:!0,isVirtual:!0,isReference:!0}]},{name:`Participant`,superClass:[`InteractionNode`,`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`interfaceRef`,type:`Interface`,isMany:!0,isReference:!0},{name:`participantMultiplicity`,type:`ParticipantMultiplicity`},{name:`endPointRefs`,type:`EndPoint`,isMany:!0,isReference:!0},{name:`processRef`,type:`Process`,isAttr:!0,isReference:!0}]},{name:`ParticipantAssociation`,superClass:[`BaseElement`],properties:[{name:`innerParticipantRef`,type:`Participant`,isAttr:!0,isReference:!0},{name:`outerParticipantRef`,type:`Participant`,isAttr:!0,isReference:!0}]},{name:`ParticipantMultiplicity`,properties:[{name:`minimum`,default:0,isAttr:!0,type:`Integer`},{name:`maximum`,default:1,isAttr:!0,type:`Integer`}],superClass:[`BaseElement`]},{name:`Collaboration`,superClass:[`RootElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`isClosed`,isAttr:!0,type:`Boolean`},{name:`participants`,type:`Participant`,isMany:!0},{name:`messageFlows`,type:`MessageFlow`,isMany:!0},{name:`artifacts`,type:`Artifact`,isMany:!0},{name:`conversations`,type:`ConversationNode`,isMany:!0},{name:`conversationAssociations`,type:`ConversationAssociation`},{name:`participantAssociations`,type:`ParticipantAssociation`,isMany:!0},{name:`messageFlowAssociations`,type:`MessageFlowAssociation`,isMany:!0},{name:`correlationKeys`,type:`CorrelationKey`,isMany:!0},{name:`choreographyRef`,type:`Choreography`,isMany:!0,isReference:!0},{name:`conversationLinks`,type:`ConversationLink`,isMany:!0}]},{name:`ChoreographyActivity`,isAbstract:!0,superClass:[`FlowNode`],properties:[{name:`participantRef`,type:`Participant`,isMany:!0,isReference:!0},{name:`initiatingParticipantRef`,type:`Participant`,isAttr:!0,isReference:!0},{name:`correlationKeys`,type:`CorrelationKey`,isMany:!0},{name:`loopType`,type:`ChoreographyLoopType`,default:`None`,isAttr:!0}]},{name:`CallChoreography`,superClass:[`ChoreographyActivity`],properties:[{name:`calledChoreographyRef`,type:`Choreography`,isAttr:!0,isReference:!0},{name:`participantAssociations`,type:`ParticipantAssociation`,isMany:!0}]},{name:`SubChoreography`,superClass:[`ChoreographyActivity`,`FlowElementsContainer`],properties:[{name:`artifacts`,type:`Artifact`,isMany:!0}]},{name:`ChoreographyTask`,superClass:[`ChoreographyActivity`],properties:[{name:`messageFlowRef`,type:`MessageFlow`,isMany:!0,isReference:!0}]},{name:`Choreography`,superClass:[`Collaboration`,`FlowElementsContainer`]},{name:`GlobalChoreographyTask`,superClass:[`Choreography`],properties:[{name:`initiatingParticipantRef`,type:`Participant`,isAttr:!0,isReference:!0}]},{name:`TextAnnotation`,superClass:[`Artifact`],properties:[{name:`text`,type:`String`},{name:`textFormat`,default:`text/plain`,isAttr:!0,type:`String`}]},{name:`Group`,superClass:[`Artifact`],properties:[{name:`categoryValueRef`,type:`CategoryValue`,isAttr:!0,isReference:!0}]},{name:`Association`,superClass:[`Artifact`],properties:[{name:`associationDirection`,type:`AssociationDirection`,isAttr:!0},{name:`sourceRef`,type:`BaseElement`,isAttr:!0,isReference:!0},{name:`targetRef`,type:`BaseElement`,isAttr:!0,isReference:!0}]},{name:`Category`,superClass:[`RootElement`],properties:[{name:`categoryValue`,type:`CategoryValue`,isMany:!0},{name:`name`,isAttr:!0,type:`String`}]},{name:`Artifact`,isAbstract:!0,superClass:[`BaseElement`]},{name:`CategoryValue`,superClass:[`BaseElement`],properties:[{name:`categorizedFlowElements`,type:`FlowElement`,isMany:!0,isVirtual:!0,isReference:!0},{name:`value`,isAttr:!0,type:`String`}]},{name:`Activity`,isAbstract:!0,superClass:[`FlowNode`],properties:[{name:`isForCompensation`,default:!1,isAttr:!0,type:`Boolean`},{name:`default`,type:`SequenceFlow`,isAttr:!0,isReference:!0},{name:`ioSpecification`,type:`InputOutputSpecification`,xml:{serialize:`property`}},{name:`boundaryEventRefs`,type:`BoundaryEvent`,isMany:!0,isReference:!0},{name:`properties`,type:`Property`,isMany:!0},{name:`dataInputAssociations`,type:`DataInputAssociation`,isMany:!0},{name:`dataOutputAssociations`,type:`DataOutputAssociation`,isMany:!0},{name:`startQuantity`,default:1,isAttr:!0,type:`Integer`},{name:`resources`,type:`ResourceRole`,isMany:!0},{name:`completionQuantity`,default:1,isAttr:!0,type:`Integer`},{name:`loopCharacteristics`,type:`LoopCharacteristics`}]},{name:`ServiceTask`,superClass:[`Task`],properties:[{name:`implementation`,isAttr:!0,type:`String`},{name:`operationRef`,type:`Operation`,isAttr:!0,isReference:!0}]},{name:`SubProcess`,superClass:[`Activity`,`FlowElementsContainer`,`InteractionNode`],properties:[{name:`triggeredByEvent`,default:!1,isAttr:!0,type:`Boolean`},{name:`artifacts`,type:`Artifact`,isMany:!0}]},{name:`LoopCharacteristics`,isAbstract:!0,superClass:[`BaseElement`]},{name:`MultiInstanceLoopCharacteristics`,superClass:[`LoopCharacteristics`],properties:[{name:`isSequential`,default:!1,isAttr:!0,type:`Boolean`},{name:`behavior`,type:`MultiInstanceBehavior`,default:`All`,isAttr:!0},{name:`loopCardinality`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`loopDataInputRef`,type:`ItemAwareElement`,isReference:!0},{name:`loopDataOutputRef`,type:`ItemAwareElement`,isReference:!0},{name:`inputDataItem`,type:`DataInput`,xml:{serialize:`property`}},{name:`outputDataItem`,type:`DataOutput`,xml:{serialize:`property`}},{name:`complexBehaviorDefinition`,type:`ComplexBehaviorDefinition`,isMany:!0},{name:`completionCondition`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`oneBehaviorEventRef`,type:`EventDefinition`,isAttr:!0,isReference:!0},{name:`noneBehaviorEventRef`,type:`EventDefinition`,isAttr:!0,isReference:!0}]},{name:`StandardLoopCharacteristics`,superClass:[`LoopCharacteristics`],properties:[{name:`testBefore`,default:!1,isAttr:!0,type:`Boolean`},{name:`loopCondition`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`loopMaximum`,type:`Integer`,isAttr:!0}]},{name:`CallActivity`,superClass:[`Activity`,`InteractionNode`],properties:[{name:`calledElement`,type:`String`,isAttr:!0}]},{name:`Task`,superClass:[`Activity`,`InteractionNode`]},{name:`SendTask`,superClass:[`Task`],properties:[{name:`implementation`,isAttr:!0,type:`String`},{name:`operationRef`,type:`Operation`,isAttr:!0,isReference:!0},{name:`messageRef`,type:`Message`,isAttr:!0,isReference:!0}]},{name:`ReceiveTask`,superClass:[`Task`],properties:[{name:`implementation`,isAttr:!0,type:`String`},{name:`instantiate`,default:!1,isAttr:!0,type:`Boolean`},{name:`operationRef`,type:`Operation`,isAttr:!0,isReference:!0},{name:`messageRef`,type:`Message`,isAttr:!0,isReference:!0}]},{name:`ScriptTask`,superClass:[`Task`],properties:[{name:`scriptFormat`,isAttr:!0,type:`String`},{name:`script`,type:`String`}]},{name:`BusinessRuleTask`,superClass:[`Task`],properties:[{name:`implementation`,isAttr:!0,type:`String`}]},{name:`AdHocSubProcess`,superClass:[`SubProcess`],properties:[{name:`completionCondition`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`ordering`,type:`AdHocOrdering`,isAttr:!0},{name:`cancelRemainingInstances`,default:!0,isAttr:!0,type:`Boolean`}]},{name:`Transaction`,superClass:[`SubProcess`],properties:[{name:`protocol`,isAttr:!0,type:`String`},{name:`method`,isAttr:!0,type:`String`}]},{name:`GlobalScriptTask`,superClass:[`GlobalTask`],properties:[{name:`scriptLanguage`,isAttr:!0,type:`String`},{name:`script`,isAttr:!0,type:`String`}]},{name:`GlobalBusinessRuleTask`,superClass:[`GlobalTask`],properties:[{name:`implementation`,isAttr:!0,type:`String`}]},{name:`ComplexBehaviorDefinition`,superClass:[`BaseElement`],properties:[{name:`condition`,type:`FormalExpression`},{name:`event`,type:`ImplicitThrowEvent`}]},{name:`ResourceRole`,superClass:[`BaseElement`],properties:[{name:`resourceRef`,type:`Resource`,isReference:!0},{name:`resourceParameterBindings`,type:`ResourceParameterBinding`,isMany:!0},{name:`resourceAssignmentExpression`,type:`ResourceAssignmentExpression`},{name:`name`,isAttr:!0,type:`String`}]},{name:`ResourceParameterBinding`,properties:[{name:`expression`,type:`Expression`,xml:{serialize:`xsi:type`}},{name:`parameterRef`,type:`ResourceParameter`,isAttr:!0,isReference:!0}],superClass:[`BaseElement`]},{name:`ResourceAssignmentExpression`,properties:[{name:`expression`,type:`Expression`,xml:{serialize:`xsi:type`}}],superClass:[`BaseElement`]},{name:`Import`,properties:[{name:`importType`,isAttr:!0,type:`String`},{name:`location`,isAttr:!0,type:`String`},{name:`namespace`,isAttr:!0,type:`String`}]},{name:`Definitions`,superClass:[`BaseElement`],properties:[{name:`name`,isAttr:!0,type:`String`},{name:`targetNamespace`,isAttr:!0,type:`String`},{name:`expressionLanguage`,default:`http://www.w3.org/1999/XPath`,isAttr:!0,type:`String`},{name:`typeLanguage`,default:`http://www.w3.org/2001/XMLSchema`,isAttr:!0,type:`String`},{name:`imports`,type:`Import`,isMany:!0},{name:`extensions`,type:`Extension`,isMany:!0},{name:`rootElements`,type:`RootElement`,isMany:!0},{name:`diagrams`,isMany:!0,type:`bpmndi:BPMNDiagram`},{name:`exporter`,isAttr:!0,type:`String`},{name:`relationships`,type:`Relationship`,isMany:!0},{name:`exporterVersion`,isAttr:!0,type:`String`}]}],enumerations:[{name:`ProcessType`,literalValues:[{name:`None`},{name:`Public`},{name:`Private`}]},{name:`GatewayDirection`,literalValues:[{name:`Unspecified`},{name:`Converging`},{name:`Diverging`},{name:`Mixed`}]},{name:`EventBasedGatewayType`,literalValues:[{name:`Parallel`},{name:`Exclusive`}]},{name:`RelationshipDirection`,literalValues:[{name:`None`},{name:`Forward`},{name:`Backward`},{name:`Both`}]},{name:`ItemKind`,literalValues:[{name:`Physical`},{name:`Information`}]},{name:`ChoreographyLoopType`,literalValues:[{name:`None`},{name:`Standard`},{name:`MultiInstanceSequential`},{name:`MultiInstanceParallel`}]},{name:`AssociationDirection`,literalValues:[{name:`None`},{name:`One`},{name:`Both`}]},{name:`MultiInstanceBehavior`,literalValues:[{name:`None`},{name:`One`},{name:`All`},{name:`Complex`}]},{name:`AdHocOrdering`,literalValues:[{name:`Parallel`},{name:`Sequential`}]}],xml:{tagAlias:`lowerCase`,typePrefix:`t`}},bpmndi:{name:`BPMNDI`,uri:`http://www.omg.org/spec/BPMN/20100524/DI`,prefix:`bpmndi`,types:[{name:`BPMNDiagram`,properties:[{name:`plane`,type:`BPMNPlane`,redefines:`di:Diagram#rootElement`},{name:`labelStyle`,type:`BPMNLabelStyle`,isMany:!0}],superClass:[`di:Diagram`]},{name:`BPMNPlane`,properties:[{name:`bpmnElement`,isAttr:!0,isReference:!0,type:`bpmn:BaseElement`,redefines:`di:DiagramElement#modelElement`}],superClass:[`di:Plane`]},{name:`BPMNShape`,properties:[{name:`bpmnElement`,isAttr:!0,isReference:!0,type:`bpmn:BaseElement`,redefines:`di:DiagramElement#modelElement`},{name:`isHorizontal`,isAttr:!0,type:`Boolean`},{name:`isExpanded`,isAttr:!0,type:`Boolean`},{name:`isMarkerVisible`,isAttr:!0,type:`Boolean`},{name:`label`,type:`BPMNLabel`},{name:`isMessageVisible`,isAttr:!0,type:`Boolean`},{name:`participantBandKind`,type:`ParticipantBandKind`,isAttr:!0},{name:`choreographyActivityShape`,type:`BPMNShape`,isAttr:!0,isReference:!0}],superClass:[`di:LabeledShape`]},{name:`BPMNEdge`,properties:[{name:`label`,type:`BPMNLabel`},{name:`bpmnElement`,isAttr:!0,isReference:!0,type:`bpmn:BaseElement`,redefines:`di:DiagramElement#modelElement`},{name:`sourceElement`,isAttr:!0,isReference:!0,type:`di:DiagramElement`,redefines:`di:Edge#source`},{name:`targetElement`,isAttr:!0,isReference:!0,type:`di:DiagramElement`,redefines:`di:Edge#target`},{name:`messageVisibleKind`,type:`MessageVisibleKind`,isAttr:!0,default:`initiating`}],superClass:[`di:LabeledEdge`]},{name:`BPMNLabel`,properties:[{name:`labelStyle`,type:`BPMNLabelStyle`,isAttr:!0,isReference:!0,redefines:`di:DiagramElement#style`}],superClass:[`di:Label`]},{name:`BPMNLabelStyle`,properties:[{name:`font`,type:`dc:Font`}],superClass:[`di:Style`]}],enumerations:[{name:`ParticipantBandKind`,literalValues:[{name:`top_initiating`},{name:`middle_initiating`},{name:`bottom_initiating`},{name:`top_non_initiating`},{name:`middle_non_initiating`},{name:`bottom_non_initiating`}]},{name:`MessageVisibleKind`,literalValues:[{name:`initiating`},{name:`non_initiating`}]}],associations:[]},dc:{name:`DC`,uri:`http://www.omg.org/spec/DD/20100524/DC`,prefix:`dc`,types:[{name:`Boolean`},{name:`Integer`},{name:`Real`},{name:`String`},{name:`Font`,properties:[{name:`name`,type:`String`,isAttr:!0},{name:`size`,type:`Real`,isAttr:!0},{name:`isBold`,type:`Boolean`,isAttr:!0},{name:`isItalic`,type:`Boolean`,isAttr:!0},{name:`isUnderline`,type:`Boolean`,isAttr:!0},{name:`isStrikeThrough`,type:`Boolean`,isAttr:!0}]},{name:`Point`,properties:[{name:`x`,type:`Real`,default:`0`,isAttr:!0},{name:`y`,type:`Real`,default:`0`,isAttr:!0}]},{name:`Bounds`,properties:[{name:`x`,type:`Real`,default:`0`,isAttr:!0},{name:`y`,type:`Real`,default:`0`,isAttr:!0},{name:`width`,type:`Real`,isAttr:!0},{name:`height`,type:`Real`,isAttr:!0}]}],associations:[]},di:{name:`DI`,uri:`http://www.omg.org/spec/DD/20100524/DI`,prefix:`di`,types:[{name:`DiagramElement`,isAbstract:!0,properties:[{name:`id`,isAttr:!0,isId:!0,type:`String`},{name:`extension`,type:`Extension`},{name:`owningDiagram`,type:`Diagram`,isReadOnly:!0,isVirtual:!0,isReference:!0},{name:`owningElement`,type:`DiagramElement`,isReadOnly:!0,isVirtual:!0,isReference:!0},{name:`modelElement`,isReadOnly:!0,isVirtual:!0,isReference:!0,type:`Element`},{name:`style`,type:`Style`,isReadOnly:!0,isVirtual:!0,isReference:!0},{name:`ownedElement`,type:`DiagramElement`,isReadOnly:!0,isMany:!0,isVirtual:!0}]},{name:`Node`,isAbstract:!0,superClass:[`DiagramElement`]},{name:`Edge`,isAbstract:!0,superClass:[`DiagramElement`],properties:[{name:`source`,type:`DiagramElement`,isReadOnly:!0,isVirtual:!0,isReference:!0},{name:`target`,type:`DiagramElement`,isReadOnly:!0,isVirtual:!0,isReference:!0},{name:`waypoint`,isUnique:!1,isMany:!0,type:`dc:Point`,xml:{serialize:`xsi:type`}}]},{name:`Diagram`,isAbstract:!0,properties:[{name:`id`,isAttr:!0,isId:!0,type:`String`},{name:`rootElement`,type:`DiagramElement`,isReadOnly:!0,isVirtual:!0},{name:`name`,isAttr:!0,type:`String`},{name:`documentation`,isAttr:!0,type:`String`},{name:`resolution`,isAttr:!0,type:`Real`},{name:`ownedStyle`,type:`Style`,isReadOnly:!0,isMany:!0,isVirtual:!0}]},{name:`Shape`,isAbstract:!0,superClass:[`Node`],properties:[{name:`bounds`,type:`dc:Bounds`}]},{name:`Plane`,isAbstract:!0,superClass:[`Node`],properties:[{name:`planeElement`,type:`DiagramElement`,subsettedProperty:`DiagramElement-ownedElement`,isMany:!0}]},{name:`LabeledEdge`,isAbstract:!0,superClass:[`Edge`],properties:[{name:`ownedLabel`,type:`Label`,isReadOnly:!0,subsettedProperty:`DiagramElement-ownedElement`,isMany:!0,isVirtual:!0}]},{name:`LabeledShape`,isAbstract:!0,superClass:[`Shape`],properties:[{name:`ownedLabel`,type:`Label`,isReadOnly:!0,subsettedProperty:`DiagramElement-ownedElement`,isMany:!0,isVirtual:!0}]},{name:`Label`,isAbstract:!0,superClass:[`Node`],properties:[{name:`bounds`,type:`dc:Bounds`}]},{name:`Style`,isAbstract:!0,properties:[{name:`id`,isAttr:!0,isId:!0,type:`String`}]},{name:`Extension`,properties:[{name:`values`,isMany:!0,type:`Element`}]}],associations:[],xml:{tagAlias:`lowerCase`}},bioc:{name:`bpmn.io colors for BPMN`,uri:`http://bpmn.io/schema/bpmn/biocolor/1.0`,prefix:`bioc`,types:[{name:`ColoredShape`,extends:[`bpmndi:BPMNShape`],properties:[{name:`stroke`,isAttr:!0,type:`String`},{name:`fill`,isAttr:!0,type:`String`}]},{name:`ColoredEdge`,extends:[`bpmndi:BPMNEdge`],properties:[{name:`stroke`,isAttr:!0,type:`String`},{name:`fill`,isAttr:!0,type:`String`}]}],enumerations:[],associations:[]},color:{name:`BPMN in Color`,uri:`http://www.omg.org/spec/BPMN/non-normative/color/1.0`,prefix:`color`,types:[{name:`ColoredLabel`,extends:[`bpmndi:BPMNLabel`],properties:[{name:`color`,isAttr:!0,type:`String`}]},{name:`ColoredShape`,extends:[`bpmndi:BPMNShape`],properties:[{name:`background-color`,isAttr:!0,type:`String`},{name:`border-color`,isAttr:!0,type:`String`}]},{name:`ColoredEdge`,extends:[`bpmndi:BPMNEdge`],properties:[{name:`border-color`,isAttr:!0,type:`String`}]}],enumerations:[],associations:[]}};function rt(e,t){return new tt(u({},nt,e),t)}var it=[`c`,`C`],at=[`v`,`V`],ot=[`d`,`D`],st=[`x`,`X`],ct=[`y`,`Y`],lt=[`z`,`Z`];function ut(e){return e.ctrlKey||e.metaKey||e.shiftKey||e.altKey}function K(e){return e.altKey?!1:e.ctrlKey||e.metaKey}function q(e,t){return e=a(e)?e:[e],e.indexOf(t.key)!==-1||e.indexOf(t.code)!==-1}function dt(e){return e.shiftKey}function ft(e){return K(e)&&q(it,e)}function pt(e){return K(e)&&q(at,e)}function mt(e){return K(e)&&q(ot,e)}function ht(e){return K(e)&&q(st,e)}function gt(e){return K(e)&&!dt(e)&&q(lt,e)}function _t(e){return K(e)&&(q(ct,e)||q(lt,e)&&dt(e))}var vt=100,yt=e=>[...new Set(e)].slice(0,vt);function bt(e){let t=0;for(;t<e.length;){let n=e.indexOf(`<`,t);if(n<0)return!1;if(e.startsWith(`<!--`,n))return!0;if(e.startsWith(`<![CDATA[`,n)){let r=e.indexOf(`]]>`,n+9);if(r<0)return!1;t=r+3}else if(e.startsWith(`<?`,n)){let r=e.indexOf(`?>`,n+2);if(r<0)return!1;t=r+2}else t=n+1}return!1}function xt(e){let t=[];for(let n of e){let e=n.message??``,r=/nested error: duplicate ID <([^>]+)>/.exec(e);if(r)t.push({code:`duplicate-id`,severity:`error`,destructive:!0,ids:[r[1]],message:`Duplicate id "${r[1]}": the second element is dropped on save.`});else if(e.startsWith(`unparsable content`)){let n=/unparsable content <([^>]+?)\/?> detected/.exec(e);t.push({code:`unparsable-content`,severity:`warning`,destructive:!0,ids:n?[n[1]]:[],message:`Unrecognised content <${n?.[1]??`?`}> is dropped on save.`})}else if(e.startsWith(`unresolved reference`)){let r=/unresolved reference <([^>]+)>/.exec(e)?.[1],i=[r,n.element?.id].filter(e=>typeof e==`string`);t.push({code:`unresolved-reference`,severity:`warning`,destructive:!0,ids:i,message:`Reference to missing id "${r??`?`}"${n.element?.id?` from "${n.element.id}"`:``} is dropped on save.`})}else t.push({code:`import-warning`,severity:`warning`,message:e.split(`
`)[0]??e})}return t}var St=[`bpmn:FlowNode`,`bpmn:SequenceFlow`,`bpmn:MessageFlow`,`bpmn:Participant`,`bpmn:Lane`,`bpmn:Association`,`bpmn:TextAnnotation`,`bpmn:Group`,`bpmn:DataObjectReference`,`bpmn:DataStoreReference`,`bpmn:DataInputAssociation`,`bpmn:DataOutputAssociation`],Ct=e=>St.some(t=>e.$instanceOf(t)),J=e=>Array.isArray(e)?e:[];function wt(e,t){for(let n of J(e.flowElements))Ct(n)&&t.push(n),n.$instanceOf(`bpmn:SubProcess`)&&wt(n,t);for(let n of J(e.artifacts))Ct(n)&&t.push(n);for(let n of J(e.laneSets)){let e=J(n.lanes);for(;e.length;){let n=e.pop();t.push(n),e.push(...J(n.childLaneSet?.lanes))}}}function Tt(e){let t=[],n=J(e.diagrams),r=new Set;for(let e of n){let t=e.plane,n=t?.bpmnElement;n?.id&&r.add(n.id);for(let e of J(t?.planeElement)){let t=e.bpmnElement;t?.id&&r.add(t.id)}}let i=[];for(let t of J(e.rootElements))if(t.$instanceOf(`bpmn:Process`)&&wt(t,i),t.$instanceOf(`bpmn:Collaboration`)){for(let e of J(t.participants))i.push(e);for(let e of J(t.messageFlows))i.push(e);for(let e of J(t.artifacts))Ct(e)&&i.push(e)}let a=i.map(e=>e.id).filter(e=>!!e);if(n.length===0){let n=Et(e);return n.length>0&&t.push({code:`incomplete-io-specification`,severity:`warning`,ids:yt(n),message:`ioSpecification without inputSet and outputSet is invalid against the BPMN 2.0 schema.`}),a.length>0&&t.push({code:`missing-di`,severity:`error`,ids:yt(a),message:`The document has no BPMNDiagram, so there is nothing to draw. DI is not generated implicitly.`}),t}let o=Et(e);o.length>0&&t.push({code:`incomplete-io-specification`,severity:`warning`,ids:yt(o),message:`ioSpecification without inputSet and outputSet is invalid against the BPMN 2.0 schema.`});let s=a.filter(e=>!r.has(e));return s.length>0&&t.push({code:`partial-di`,severity:`warning`,ids:yt(s),message:`${s.length} element(s) have no diagram shape or edge and are not drawn.`}),t}function Et(e){let t=[],n=e=>{let r=e.ioSpecification;r&&(J(r.inputSets).length===0||J(r.outputSets).length===0)&&t.push(e.id??r.id??e.$type);for(let t of J(e.flowElements))n(t)};for(let t of J(e.rootElements))t.$instanceOf(`bpmn:Process`)&&n(t);return t}var Dt=e=>e.some(e=>e.destructive===!0),Ot;function kt(){return Ot??=e(()=>import(`./Modeler-BfAmwsmK.js`).then(e=>({Modeler:e.default}),e=>{throw Ot=void 0,e}),[]),Ot}async function At(t,n){return t===`legend`?(await e(()=>import(`./legend-CXdfCBh6.js`),[])).legendProfile(n):t===`colored`?(await e(()=>import(`./colored-CSIQaGsQ.js`),[])).coloredProfile(n):{id:`standard`,modelerModules:[],viewerModules:[]}}function jt(e,t,n){let r=n?{paletteColumns:n}:{};return t.tokens?t.id===`colored`?{instanceId:e,colored:t.tokens,...t.named?{coloredNamed:t.named}:{},...r}:{instanceId:e,legend:t.tokens,...r}:{instanceId:e,...r}}function Mt(){return`bc${Math.random().toString(36).slice(2,8)}${(Nt++).toString(36)}`}var Nt=0;function Pt(e){let t=e.plane.bpmnElement,n=(t?.participants??[]).map(e=>e.name).filter(Boolean).join(` · `);return e.name||t?.name||n||t?.id||e.id}var Ft=`bpmn-canvas--colored`,It=Object.freeze({"--bpmn-canvas-icon-start":`eventLine`,"--bpmn-canvas-icon-end":`eventLine`,"--bpmn-canvas-icon-intermediate":`eventLine`,"--bpmn-canvas-icon-task":`taskLine`,"--bpmn-canvas-icon-subprocess":`taskLine`,"--bpmn-canvas-icon-external":`externalLine`,"--bpmn-canvas-icon-gateway":`gatewayLine`,"--bpmn-canvas-icon-data":`dataLine`,"--bpmn-canvas-icon-document":`docLine`,"--bpmn-canvas-icon-application":`appLine`,"--bpmn-canvas-icon-lane":`laneLine`,"--bpmn-canvas-icon-pool":`poolLine`,"--bpmn-canvas-icon-flow":`flow`});function Lt(e){let t={};for(let[n,r]of Object.entries(It)){let i=e[r];typeof i==`string`&&i&&(t[n]=i)}return t}var Rt={__init__:[`bpmnCanvasPalette`],bpmnCanvasPalette:[`type`,class{static $inject=[`config.bpmnCanvas`,`canvas`,`eventBus`,`injector`];constructor(e,t,n,r){let i=e?.paletteColumns??`auto`,a=r.get(`palette`,!1);if(a&&i!==`auto`){let e=a._toggleState.bind(a);a._toggleState=(t={})=>e(`twoColumn`in t?t:{...t,twoColumn:i===2})}let o=e?.legend??e?.colored,s=!!e?.colored,c=[],l=null,u=()=>{if(l=t.getContainer()?.closest(`.bpmn-canvas`)??l,!l||!o||c.length>0)return;let e=Lt(o);for(let[t,n]of Object.entries(e))l.style.setProperty(t,n);c=Object.keys(e),s&&l.classList.add(Ft)};n.on(`diagram.init`,()=>{u(),queueMicrotask(u)}),n.on(`import.done`,u),n.on(`diagram.destroy`,()=>{if(l){for(let e of c)l.style.removeProperty(e);l.classList.remove(Ft),c=[],l=null}})}}]},zt={__init__:[`bpmnCanvasReadOnly`],bpmnCanvasReadOnly:[`type`,class{static $inject=[`commandStack`,`injector`];enabled=!1;directEditing;contextPad;dragging;constructor(e,t){let n=e.execute.bind(e),r=e.undo.bind(e),i=e.redo.bind(e),a=e.canExecute.bind(e);e.execute=(e,t)=>{this.enabled||n(e,t)},e.undo=()=>{this.enabled||r()},e.redo=()=>{this.enabled||i()},e.canExecute=(e,t)=>!this.enabled&&a(e,t),this.directEditing=t.get(`directEditing`,!1)??null,this.contextPad=t.get(`contextPad`,!1)??null,this.dragging=t.get(`dragging`,!1)??null;let o=this.directEditing;if(o?.activate){let e=o.activate.bind(o);o.activate=(...t)=>this.enabled?void 0:e(...t)}}setReadOnly(e){this.enabled=e,e&&(this.directEditing?.cancel?.(),this.contextPad?.close?.(),this.dragging?.cancel?.())}isReadOnly(){return this.enabled}}]};function Bt(){return{"inline-01.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='17'%20height='17'%20viewBox='0%200%2024%2024'%3e%3cpath%20d='M10%206L8.59%207.41%2013.17%2012l-4.58%204.59L10%2018l6-6z'%20/%3e%3cpath%20d='M0%200h24v24H0z'%20fill='none'%20/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-02.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3ccircle%20cx='16'%20cy='16'%20r='11'%20stroke-width='2'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-03.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3ccircle%20cx='16'%20cy='16'%20r='11'%20stroke-width='4'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-04.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3ccircle%20cx='16'%20cy='16'%20r='11'%20stroke-width='1.5'/%3e%3ccircle%20cx='16'%20cy='16'%20r='8'%20stroke-width='1.5'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-05.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3crect%20x='3'%20y='6'%20width='26'%20height='20'%20rx='4'%20stroke-width='2'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-06.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3crect%20x='3'%20y='6'%20width='26'%20height='20'%20rx='4'%20stroke-width='2'/%3e%3crect%20x='12'%20y='18'%20width='8'%20height='6'%20stroke-width='1'/%3e%3cpath%20d='M16%2019.5v3M14.5%2021h3'%20stroke-width='1'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-07.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3crect%20x='3'%20y='6'%20width='26'%20height='20'%20rx='4'%20stroke-width='1.5'/%3e%3cpath%20d='M19%2010h4v-2l4%203l-4%203v-2h-4Z'%20stroke-width='1.2'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-08.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpolygon%20points='16,3%2029,16%2016,29%203,16'%20stroke-width='2'/%3e%3cpath%20d='M12%2012l8%208M20%2012l-8%208'%20stroke-width='2.5'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-09.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpolygon%20points='16,3%2029,16%2016,29%203,16'%20stroke-width='2'/%3e%3cpath%20d='M16%2010v12M10%2016h12'%20stroke-width='2.5'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-10.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpath%20d='M8%2010h11l5%205v14H8z'%20stroke-width='1.5'/%3e%3cpath%20d='M19%2010v5h5'%20stroke-width='1.5'/%3e%3cpath%20d='M16%201v7M13%205l3%203l3-3'%20stroke-width='1.8'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-11.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpath%20d='M8%2010h11l5%205v14H8z'%20stroke-width='1.5'/%3e%3cpath%20d='M19%2010v5h5'%20stroke-width='1.5'/%3e%3cpath%20d='M16%208V1M13%204l3-3l3%203'%20stroke-width='1.8'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-12.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpath%20d='M7%204h12l6%206v18H7z'%20stroke-width='1.5'/%3e%3cpath%20d='M19%204v6h6'%20stroke-width='1.5'/%3e%3cpath%20d='M10%2011h4v-2.5l5%203.5l-5%203.5v-2.5h-4Z'%20stroke-width='1.2'%20fill='none'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-13.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpath%20d='M7%204h12l6%206v18H7z'%20stroke-width='1.5'/%3e%3cpath%20d='M19%204v6h6'%20stroke-width='1.5'/%3e%3cpath%20d='M10%2011h4v-2.5l5%203.5l-5%203.5v-2.5h-4Z'%20stroke-width='1.2'%20fill='black'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-14.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpath%20d='M6%205h20v18.7q-5%20-4.8%20-10%200q-5%204.8%20-10%200Z'%20stroke-width='1.5'/%3e%3cpath%20d='M6%2010h20'%20stroke-width='1.2'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-15.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3crect%20x='7'%20y='5'%20width='22'%20height='22'%20rx='2'%20stroke-width='2'/%3e%3crect%20x='3'%20y='9'%20width='7'%20height='4'%20stroke-width='1.5'/%3e%3crect%20x='3'%20y='18'%20width='7'%20height='4'%20stroke-width='1.5'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-16.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3crect%20x='4'%20y='6'%20width='24'%20height='20'%20stroke-width='2'/%3e%3cpath%20d='M11%206v20'%20stroke-width='1.5'/%3e%3c/svg%3e`,``+import.meta.url).href,"inline-17.svg":new URL(`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%20fill='none'%20stroke='black'%20stroke-linecap='round'%20stroke-linejoin='round'%3e%3cpath%20d='M4%2022L20%2010'%20stroke-width='2'/%3e%3cpolygon%20points='28,6%2020,8%2024,14'%20fill='black'%20stroke-width='1'/%3e%3c/svg%3e`,``+import.meta.url).href}}var Vt=`__ASSET__`,Ht=`/**
 * Semantic tokens, copied from \`@bpmn-io/theme\` to style the components
 * according to this theme.
 *
 * Names and values of the tokens should stay intact with the \`@bpmn-io/theme\`
 * source of truth, to ensure matching styles and allow overrides with an
 * alternative theme.
 */
.bio-theme-parent {
  --bio-surface: hsl(0, 0%, 100%);
  --bio-surface-overlay: hsl(0, 0%, 100%);
  --bio-surface-subtle: hsl(225, 10%, 97%);
  --bio-surface-medium: hsl(225, 10%, 95%);
  --bio-surface-inverted: hsl(0, 0%, 22%);
  --bio-surface-inverted-subtle: hsl(225, 10%, 35%);
  --bio-text: hsl(225, 10%, 15%);
  --bio-text-subtle: hsl(225, 10%, 35%);
  --bio-text-subtlest: hsl(225, 10%, 55%);
  --bio-text-on-inverted: hsl(0, 0%, 100%);
  --bio-border: hsl(225, 10%, 75%);
  --bio-border-disabled: hsl(225, 10%, 90%);
  --bio-primary: hsl(205, 100%, 40%);
  --bio-primary-surface: hsl(205, 100%, 95%);
  --bio-danger: hsl(360, 100%, 45%);
  --bio-danger-surface-subtle: hsl(360, 100%, 97%);
  --bio-selected-surface: var(--bio-surface-medium);
  --bio-selected-text: var(--bio-text);
  --bio-focus: hsl(205, 100%, 40%);
  --bio-focus-surface: hsl(205, 100%, 95%);
  --bio-canvas-accent: hsl(205, 100%, 40%);
  --bio-canvas-accent-subtle: hsl(205, 100%, 75%);
  --bio-shadow: hsla(0, 0%, 0%, 30%);
  --bio-shadow-subtle: hsla(0, 0%, 0%, 10%);
  --bio-radius-sm: 2px;
  --bio-radius-md: 3px;
  --bio-radius-lg: 4px;
}

/**
 * color definitions
 *
 * Colours resolve through the semantic tokens in \`@bpmn-io/theme\`; a handful of
 * values with no matching token stay literal.
 */
.djs-parent {

  --button-border-radius: var(--bio-radius-md);
  --input-border-radius: var(--bio-radius-sm);
  --surface-border-radius: var(--bio-radius-lg);

  --canvas-fill-color: var(--bio-surface);

  --accent-color: var(--bio-canvas-accent);

  --bendpoint-fill-color: var(--bio-canvas-accent);
  --bendpoint-stroke-color: var(--canvas-fill-color);

  --context-pad-entry-background-color: var(--bio-surface);
  --context-pad-entry-hover-background-color: var(--bio-surface-medium);

  --element-dragger-color: var(--accent-color);
  --element-selected-outline-stroke-color: var(--accent-color);
  --element-selected-outline-secondary-stroke-color: var(--bio-canvas-accent-subtle);

  --lasso-fill-color: color-mix(in srgb, var(--bio-canvas-accent) 15%, transparent);
  --lasso-stroke-color: var(--element-selected-outline-stroke-color);

  --palette-entry-color: var(--bio-text);
  --palette-entry-hover-color: var(--bio-primary);
  --palette-entry-selected-color: var(--bio-primary);
  --palette-separator-color: var(--bio-border);
  --palette-toggle-hover-background-color: var(--bio-surface-medium);
  --palette-background-color: var(--bio-surface-subtle);
  --palette-border-color: var(--bio-border);

  --popup-font-family: "IBM Plex Sans", sans-serif;
  --popup-font-size: 14px;
  --popup-secondary-font-size: .9em;
  --popup-header-entry-selected-color: var(--bio-primary);
  --popup-header-font-weight: bolder;
  --popup-header-group-divider-color: var(--bio-border);
  --popup-background-color: var(--bio-surface-overlay);
  --popup-border-color: transparent;
  --popup-shadow-color: var(--bio-shadow);
  /* translucent, so the thumb darkens whatever it scrolls over */
  --popup-scrollbar-thumb-color: rgba(0, 0, 0, 0.2);
  --popup-button-background-color: var(--bio-surface-overlay);
  --popup-button-hover-background-color: var(--bio-surface-medium);
  --popup-disabled-color: var(--bio-text-subtle);
  --popup-description-color: var(--bio-text-subtle);
  --popup-no-results-color: var(--bio-text-subtlest);
  --popup-entry-title-color: var(--bio-text-subtlest);

  --popup-entry-selected-background-color: var(--bio-selected-surface);
  --popup-entry-selected-color: var(--bio-selected-text);
  --popup-search-border-color: var(--bio-border);
  --popup-search-focus-border-color: var(--bio-focus);
  --popup-search-focus-background-color: var(--bio-focus-surface);
  --popup-tab-color: var(--bio-text-subtlest);
  --popup-tab-hover-color: var(--bio-text);
  --popup-tab-active-color: var(--bio-text);
  --popup-tab-active-border-color: var(--bio-primary);
  --popup-tab-strip-border-color: var(--bio-border-disabled);
  --popup-tab-focus-border-color: var(--bio-focus);

  --resizer-fill-color: var(--bio-canvas-accent);
  --resizer-stroke-color: var(--canvas-fill-color);

  --search-font-family: "IBM Plex Sans", sans-serif;
  --search-font-size: 14px;
  --search-container-background-color: var(--bio-surface-overlay);
  --search-shadow-color: var(--bio-shadow);
  --search-input-border-color: var(--bio-border);
  --search-input-focus-border-color: var(--bio-focus);
  --search-input-focus-background-color: var(--bio-primary-surface);
  --search-result-hover-background-color: var(--bio-surface-medium);
  --search-result-secondary-color: var(--bio-text-subtlest);
  --search-preselected-background-color: color-mix(in srgb, var(--bio-canvas-accent) 15%, transparent);

  --shape-attach-allowed-stroke-color: var(--accent-color);
  --shape-connect-allowed-fill-color: var(--bio-surface-subtle);
  --shape-drop-allowed-fill-color: var(--bio-surface-subtle);
  --shape-drop-not-allowed-fill-color: var(--bio-danger-surface-subtle);
  --shape-resize-preview-stroke-color: var(--accent-color);

  --snap-line-stroke-color: color-mix(in srgb, var(--bio-canvas-accent) 30%, transparent);

  --space-tool-crosshair-stroke-color: var(--bio-text);

  --tooltip-error-background-color: var(--bio-danger-surface-subtle);
  --tooltip-error-border-color: var(--bio-danger);
  --tooltip-error-color: var(--bio-danger);

  --hover-tooltip-font-family: "IBM Plex Sans", sans-serif;
  --hover-tooltip-font-size: 12px;
  --hover-tooltip-secondary-font-size: 11px;
  --hover-tooltip-background-color: var(--bio-surface-inverted);
  --hover-tooltip-color: var(--bio-text-on-inverted);
  --hover-tooltip-shadow-color: var(--bio-shadow-subtle);

  --palette-tooltip-shortcut-background-color: var(--bio-surface-inverted-subtle);
}

/**
 * SVG styles
 */

.djs-container svg.drop-not-ok {
  background: var(--shape-drop-not-allowed-fill-color) !important;
}

.djs-container svg.new-parent {
  background: var(--shape-drop-allowed-fill-color) !important;
}

.djs-container svg:focus {
  outline-offset: -1px;
}

/**
 * outline styles
 */

.djs-outline,
.djs-selection-outline {
  fill: none;
  shape-rendering: geometricPrecision;
  stroke-width: 2px;
}

.djs-outline {
  visibility: hidden;
}

.djs-selection-outline {
  stroke: var(--element-selected-outline-stroke-color);
}

.djs-element.selected .djs-outline {
  visibility: visible;

  stroke: var(--element-selected-outline-stroke-color);
}

.djs-connection.selected .djs-outline {
  display: none;
}

.djs-multi-select .djs-element.selected .djs-outline,
.djs-dragging-active-lasso .djs-element.selected .djs-outline {
  stroke: var(--element-selected-outline-secondary-stroke-color);
  display: block;
}

.djs-outline-hidden .djs-outline {
  display: none !important;
}

.djs-shape.connect-ok .djs-visual > :nth-child(1) {
  fill: var(--shape-connect-allowed-fill-color) !important;
}

.djs-shape.connect-not-ok .djs-visual > :nth-child(1),
.djs-shape.drop-not-ok .djs-visual > :nth-child(1) {
  fill: var(--shape-drop-not-allowed-fill-color) !important;
}

.djs-shape.new-parent .djs-visual > :nth-child(1) {
  fill: var(--shape-drop-allowed-fill-color) !important;
}


/* Override move cursor during drop and connect */
.drop-not-ok,
.connect-not-ok,
.drop-not-ok *,
.connect-not-ok * {
  cursor: not-allowed !important;
}

.drop-ok,
.connect-ok,
.drop-ok *,
.connect-ok * {
  cursor: default !important;
}

.djs-element.attach-ok .djs-visual > :nth-child(1) {
  stroke-width: 5px !important;
  stroke: var(--shape-attach-allowed-stroke-color) !important;
}

.djs-frame.connect-not-ok .djs-visual > :nth-child(1),
.djs-frame.drop-not-ok .djs-visual > :nth-child(1) {
  stroke-width: 3px !important;
  stroke: var(--shape-drop-not-allowed-fill-color) !important;
  fill: none !important;
}

/**
* Selection box style
*
*/
.djs-lasso-overlay {
  fill: var(--lasso-fill-color);
  stroke: var(--lasso-stroke-color);
  stroke-width: 2px;
  shape-rendering: geometricPrecision;
  pointer-events: none;
}

/**
 * Resize styles
 */
.djs-resize-overlay {
  fill: none;

  stroke-dasharray: 5 1 3 1;
  stroke: var(--shape-resize-preview-stroke-color);

  pointer-events: none;
}

.djs-resizer-hit {
  fill: none;
  pointer-events: all;
}

.djs-resizer-visual {
  fill: var(--resizer-fill-color);
  stroke-width: 1px;
  stroke: var(--resizer-stroke-color);
  shape-rendering: geometricPrecision;
}

.djs-resizer:hover .djs-resizer-visual {
  stroke: var(--resizer-stroke-color);
  stroke-opacity: 1;
}

.djs-cursor-resize-ns,
.djs-resizer-n,
.djs-resizer-s {
  cursor: ns-resize;
}

.djs-cursor-resize-ew,
.djs-resizer-e,
.djs-resizer-w {
  cursor: ew-resize;
}

.djs-cursor-resize-nwse,
.djs-resizer-nw,
.djs-resizer-se {
  cursor: nwse-resize;
}

.djs-cursor-resize-nesw,
.djs-resizer-ne,
.djs-resizer-sw {
  cursor: nesw-resize;
}

.djs-shape.djs-resizing > .djs-outline {
  visibility: hidden !important;
}

.djs-shape.djs-resizing > .djs-resizer {
  visibility: hidden;
}

.djs-dragger > .djs-resizer {
  visibility: hidden;
}

/**
 * drag styles
 */
.djs-dragger * {
  fill: none !important;
  stroke: var(--element-dragger-color) !important;
}

.djs-dragger tspan,
.djs-dragger text {
  fill: var(--element-dragger-color) !important;
  stroke: none !important;
}

.djs-dragger marker circle,
.djs-dragger marker path,
.djs-dragger marker polygon,
.djs-dragger marker polyline,
.djs-dragger marker rect {
  fill: var(--element-dragger-color) !important;
  stroke: none !important;
}

.djs-dragger marker text,
.djs-dragger marker tspan {
  fill: none !important;
  stroke: var(--element-dragger-color) !important;
}

.djs-dragging,
.djs-dragging > * {
  opacity: 0.3 !important;
  pointer-events: none !important;
}

/**
 * no pointer events for visual
 */
.djs-visual,
.djs-outline {
  pointer-events: none;
}

.djs-element.attach-ok .djs-hit {
  stroke-width: 60px !important;
}

/**
 * all pointer events for hit shape
 */
.djs-element > .djs-hit-all,
.djs-element > .djs-hit-no-move {
  pointer-events: all;
}

.djs-element > .djs-hit-stroke,
.djs-element > .djs-hit-click-stroke {
  pointer-events: stroke;
}

/**
 * shape / connection basic styles
 */
.djs-connection .djs-visual {
  stroke-width: 2px;
  fill: none;
}

.djs-cursor-grab {
  cursor: -webkit-grab;
  cursor: -moz-grab;
  cursor: grab;
}

.djs-cursor-grabbing {
  cursor: -webkit-grabbing;
  cursor: -moz-grabbing;
  cursor: grabbing;
}

.djs-cursor-crosshair {
  cursor: crosshair;
}

.djs-cursor-move {
  cursor: move;
}

.djs-cursor-resize-ns {
  cursor: ns-resize;
}

.djs-cursor-resize-ew {
  cursor: ew-resize;
}


/**
 * snapping
 */
.djs-snap-line {
  stroke: var(--snap-line-stroke-color);
  stroke-linecap: round;
  stroke-width: 2px;
  pointer-events: none;
}

/**
 * snapping
 */
.djs-crosshair {
  stroke: var(--space-tool-crosshair-stroke-color);
  stroke-linecap: round;
  stroke-width: 1px;
  pointer-events: none;
  shape-rendering: geometricPrecision;
  stroke-dasharray: 5, 5;
}

/**
 * palette
 */

.djs-palette {
  position: absolute;
  left: 20px;
  top: 20px;

  box-sizing: border-box;
  width: 48px;
}

.djs-palette .separator {
  margin: 5px;
  padding-top: 5px;

  border: none;
  border-bottom: solid 1px var(--palette-separator-color);

  clear: both;
}

.djs-palette .entry:before {
  vertical-align: initial;
}

.djs-palette .djs-palette-toggle {
  cursor: pointer;
}

.djs-palette .entry,
.djs-palette .djs-palette-toggle {
  color: var(--palette-entry-color);
  font-size: 30px;

  text-align: center;
}

.djs-palette .entry {
  float: left;
}

.djs-palette .entry img {
  max-width: 100%;
}

.djs-palette .djs-palette-entries:after {
  content: '';
  display: table;
  clear: both;
}

.djs-palette .djs-palette-toggle:hover {
  background: var(--palette-toggle-hover-background-color);
}

.djs-palette .entry:hover {
  color: var(--palette-entry-hover-color);
}

.djs-palette .highlighted-entry {
  color: var(--palette-entry-selected-color) !important;
}

.djs-palette .entry,
.djs-palette .djs-palette-toggle {
  width: 46px;
  height: 46px;
  line-height: 46px;
  cursor: default;
}

/**
 * Palette open / two-column layout is controlled via
 * classes on the palette. Events to hook into palette
 * changed life-cycle are available in addition.
 */
.djs-palette.two-column.open {
  width: 94px;
}

.djs-palette:not(.open) .djs-palette-entries {
  display: none;
}

.djs-palette:not(.open) {
  overflow: hidden;
}

.djs-palette.open .djs-palette-toggle {
  display: none;
}

.djs-hover-tooltip {
  position: fixed;
  z-index: 1000;

  display: flex;
  align-items: center;
  gap: 6px;

  padding: 6px 10px;
  border-radius: var(--surface-border-radius);

  background-color: var(--hover-tooltip-background-color);
  color: var(--hover-tooltip-color);

  font-family: var(--hover-tooltip-font-family);
  font-size: var(--hover-tooltip-font-size);
  line-height: 1.2;
  white-space: nowrap;

  pointer-events: none;
  box-shadow: 0 1px 4px var(--hover-tooltip-shadow-color);
}

.djs-hover-tooltip--right {
  transform: translateY(-50%);
}

.djs-hover-tooltip--top {
  transform: translate(-50%, -100%);
}

.djs-palette-tooltip-shortcut {
  padding: 1px 5px;

  border-radius: var(--button-border-radius);

  background-color: var(--palette-tooltip-shortcut-background-color);

  font-family: monospace;
  font-size: var(--hover-tooltip-secondary-font-size);
  line-height: 1.2;
}

/**
 * context-pad
 */
.djs-context-pad {
  position: absolute;
  display: none;
  pointer-events: none;
  line-height: 1;
  width: 72px;
  z-index: 100;
}

.djs-context-pad .entry {
  width: 22px;
  height: 22px;
  text-align: center;
  display: inline-block;
  font-size: 22px;
  margin: 0 2px 2px 0;

  border-radius: 3px;

  cursor: default;

  background-color: var(--context-pad-entry-background-color);
  box-shadow: 0 0 2px 1px var(--context-pad-entry-background-color);
  pointer-events: all;
  vertical-align: middle;
}

.djs-context-pad .entry:hover {
  background: var(--context-pad-entry-hover-background-color);
}

.djs-context-pad.open {
  display: block;
}

/**
 * popup styles
 */
.djs-popup {
  line-height: 1;
  box-sizing: border-box;
  background: var(--popup-background-color);
  overflow: hidden;
  position: fixed;
  z-index: 200;
  box-shadow: 0px 2px 6px var(--popup-shadow-color);
  border: solid 1px var(--popup-border-color);
  min-width: 120px;
  max-width: 300px;
  outline: none;
  font-size: var(--popup-font-size);
  font-family: var(--popup-font-family);
}

.djs-popup-search input {
  width: 100%;
  box-sizing: border-box;
  font-size: var(--popup-font-size);
  padding: 3px 6px 3px 28px;
  border-radius: var(--input-border-radius);
  border: solid 1px var(--popup-search-border-color);
  line-height: 21px;
}

.djs-popup-search input:focus {
  background-color: var(--popup-search-focus-background-color);
  border: solid 1px var(--popup-search-focus-border-color);
  outline: none;
}

.djs-popup-header {
  display: flex;
  align-items: stretch;
  line-height: 20px;
  margin: 10px 12px 10px 12px;
}

.djs-popup-header .entry {
  border-radius: 2px;
}

.djs-popup button.entry {
  padding: 0;
  background: transparent;
  border: 0;
}

.djs-popup-header .entry.active {
  color: var(--popup-header-entry-selected-color);
}

.djs-popup-header .entry.disabled {
  color: inherit;
}

.djs-popup-header-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  list-style: none;
  margin: 0;
  padding: 0;
}

.djs-popup-header-group .entry {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.djs-popup-header-group + .djs-popup-header-group:before {
  content: '';
  width: 1px;
  height: 20px;
  background: var(--popup-header-group-divider-color);
  margin: 0 5px;
}

.djs-popup-search {
  position: relative;
  width: auto;
  margin: 10px 12px;
}

.djs-popup-tabs-container {
  position: relative;
  border-bottom: solid 1px var(--popup-tab-strip-border-color);
}

/**
 * The scroll control doubles as the edge fade: tabs scrolled past it fade out
 * rather than being cut off behind an opaque block.
 */
.djs-popup-tabs-scroll {
  appearance: none;
  position: absolute;
  top: 0;
  bottom: 1px;
  width: 28px;
  display: flex;
  align-items: center;
  padding: 0;
  border: none;
  border-radius: 0;
  color: var(--popup-tab-color);
  cursor: pointer;
}

.djs-popup-tabs-scroll:hover {
  color: var(--popup-tab-hover-color);
}

.djs-popup-tabs-scroll-start {
  left: 0;
  justify-content: flex-start;
  background: linear-gradient(to left, transparent, var(--popup-background-color) 60%);
}

.djs-popup-tabs-scroll-end {
  right: 0;
  justify-content: flex-end;
  background: linear-gradient(to right, transparent, var(--popup-background-color) 60%);
}

.djs-popup-tabs-scroll-start svg {
  transform: rotate(180deg);
}

.djs-popup-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0 12px;

  /* keep scrolled-to tabs clear of the scroll controls */
  scroll-padding: 0 28px;
  scrollbar-width: none;
}

.djs-popup-tabs::-webkit-scrollbar {
  display: none;
}

.djs-popup-tab {
  appearance: none;
  background: transparent;
  border: none;
  border-bottom: solid 2px transparent;
  border-radius: 0;
  flex: 0 0 auto;
  padding: 6px 10px;
  font: inherit;
  font-size: var(--popup-font-size);
  color: var(--popup-tab-color);
  cursor: pointer;
  white-space: nowrap;
}

.djs-popup-tab:hover {
  color: var(--popup-tab-hover-color);
}

.djs-popup-tab:focus-visible {
  outline: solid 1px var(--popup-tab-focus-border-color);
  outline-offset: -2px;
}

.djs-popup-tab[aria-selected="true"] {
  color: var(--popup-tab-active-color);
  border-bottom-color: var(--popup-tab-active-border-color);
  font-weight: var(--popup-header-font-weight);
}

.djs-popup-title {
  font-size: var(--popup-font-size);
  font-weight: var(--popup-header-font-weight);
  flex: 1;
  margin: 0;
}

.djs-popup-breadcrumbs {
  display: flex;
  line-height: 20px;
  margin: 10px 12px;
}

.djs-popup-breadcrumbs-item {
  display: inline-flex;
  min-width: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  border: 0;
  outline: none;
  appearance: none;
  color: var(--popup-description-color);
  font: inherit;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.djs-popup-breadcrumbs-item--separator::before {
  display: inline-block;
  content: '/';
  color: var(--popup-description-color);
  margin: 0 4px;
}

.djs-popup-breadcrumbs-item:hover {
  color: inherit;
  text-decoration: underline;
}

.djs-popup-breadcrumbs-item:focus-visible {
  outline: 1px solid var(--popup-search-focus-border-color);
  outline-offset: 2px;
}

.djs-popup-breadcrumbs-item--back {
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 2px 3px;
  margin-right: 6px;
  border: 1px solid var(--popup-search-border-color);
  border-radius: 4px;
}

.djs-popup-breadcrumbs-item--back:hover {
  background: var(--popup-button-hover-background-color);
}

.djs-popup-breadcrumbs-item--current {
  font-weight: var(--popup-header-font-weight);
  color: inherit;
  cursor: default;
}

.djs-popup-breadcrumbs-item--current:hover {
  text-decoration: none;
}

.djs-popup-entry-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  margin-left: 6px;
}

.djs-popup-entry-chevron {
  display: flex;
  align-items: center;
  color: var(--popup-description-color);
}

.djs-popup-search-icon {
  position: absolute;
  left: 8px;
  top: 7px;
}

.djs-popup-search-count {
  margin: 0 12px;
  font-size: var(--popup-secondary-font-size);
  color: var(--popup-description-color);
}

.djs-popup-results {
  margin: 7px 3px 7px 12px;
  list-style: none;
  max-height: 280px;
  overflow: auto;
  padding-right: 9px;
}

/**
 * The results list is focusable (as a listbox holding
 * \`aria-activedescendant\`) when there is no search field.
 * The active entry is indicated via \`.entry.selected\`, so we hide
 * the outline on the list container itself.
 */
.djs-popup-results:focus {
  outline: none;
}

.djs-popup-group {
  margin: 0;
  padding: 0;
  width: 100%;
}

.djs-popup-body .entry,
.djs-popup-body .entry-header {
  padding: 5px 7px;
  cursor: default;
  border-radius: 4px;
}

.djs-popup-body .entry-header {
  font-weight: var(--popup-header-font-weight);
  color: var(--popup-entry-title-color);
  padding-left: 0;
}

.djs-popup [class*="icon"] .djs-popup-label,
.djs-popup-label:not(:first-child) {
  margin-left: .5em;
}

.djs-popup [class*="icon"]:before,
.djs-popup-entry-icon {
  width: 1em;
  height: 1em;
  display: inline-block;
  font-size: 1.4em;
  vertical-align: middle;
}

.djs-popup-body .entry-header:not(:first-child) {
  margin-top: 8px;
  margin-bottom: 2px;
}

.djs-popup-body .entry {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: min-content;
}

.djs-popup .entry.selected {
  color: var(--popup-entry-selected-color);
  background-color: var(--popup-entry-selected-background-color);
}

.djs-popup .entry.disabled {
  color: var(--popup-disabled-color);
  cursor: not-allowed;
}

.djs-popup-body .entry:not(:first-child) {
  margin-top: 2px;
}

.djs-popup-entry-content {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.djs-popup-entry-description {
  font-size: var(--popup-secondary-font-size);
  margin-top: .25em;

  color: var(--popup-description-color);
}

.djs-popup-label,
.djs-popup-entry-description {
  line-height: 1.4em;
}

.djs-popup .entry,
.djs-popup .entry-header {
  margin: 1px;
}

.djs-popup-body {
  flex-direction: column;
  width: auto;
}

.djs-popup *::-webkit-scrollbar {
  width: 6px;
}

.djs-popup *::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background-color: var(--popup-scrollbar-thumb-color);
}

.djs-popup *::-webkit-scrollbar-track {
  box-shadow: none;
  background: transparent;
  margin: 0;
  padding: 5px;
}

.djs-popup-no-results {
  padding: 0 12px 12px 12px;
  color: var(--popup-no-results-color);
}

.djs-popup-footer {
  display: flex;
  padding: 5px 12px 7px 12px;
  border-top: solid 1px var(--popup-border-color);
}

/**
 * The footer holds the keyboard/assistive-technology reachable documentation
 * link. Pointer interaction switches the popup to the per-entry
 * \`.djs-popup-entry-docs\` affordance instead.
 */
.djs-popup--pointer .djs-popup-footer {
  display: none;
}

.djs-popup-entry-docs {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  visibility: hidden;
  padding: 2px 3px;
  color: var(--popup-description-color);
  background: var(--popup-button-background-color);
  border: 1px solid var(--popup-search-border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color .12s ease, border-color .12s ease, color .12s ease;
}

.djs-popup--pointer .djs-popup-body .entry:hover .djs-popup-entry-docs {
  visibility: visible;
}

.djs-popup-body .entry .djs-popup-entry-docs:hover {
  background: var(--popup-button-hover-background-color);
}

.djs-popup-entry-docs svg {
  vertical-align: middle;
}

.djs-popup-footer-docs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--popup-secondary-font-size);
  color: var(--popup-description-color);
  text-decoration: none;
}

.djs-popup-footer-docs:hover {
  text-decoration: underline;
}

.djs-popup-footer-docs svg {
  vertical-align: middle;
  margin: 2px;
}

/**
 *  palette styles
 */
.djs-palette {
  background: var(--palette-background-color);
  border: solid 1px var(--palette-border-color);
  border-radius: var(--surface-border-radius);
}

/**
 * bendpoints
 */
.djs-segment-dragger,
.djs-bendpoint {
  display: none;
}

.djs-segment-dragger .djs-visual {
  display: none;

  fill: var(--bendpoint-fill-color);
  stroke: var(--bendpoint-stroke-color);
  stroke-width: 1px;
  stroke-opacity: 1;
}

.djs-segment-dragger:hover .djs-visual {
  display: block;
}

.djs-bendpoint .djs-visual {
  fill: var(--bendpoint-fill-color);
  stroke: var(--bendpoint-stroke-color);
  stroke-width: 1px;
}

.djs-segment-dragger:hover,
.djs-bendpoints.hover .djs-segment-dragger,
.djs-bendpoints.selected .djs-segment-dragger,
.djs-bendpoint:hover,
.djs-bendpoints.hover .djs-bendpoint,
.djs-bendpoints.selected .djs-bendpoint {
  display: block;
}

.djs-drag-active .djs-bendpoints * {
  display: none;
}

.djs-bendpoints:not(.hover) .floating {
  display: none;
}

.djs-bendpoint.floating:not(.positioned) {
  display: none;
}

.djs-segment-dragger:hover .djs-visual,
.djs-segment-dragger.djs-dragging .djs-visual,
.djs-bendpoint:hover .djs-visual,
.djs-bendpoint.floating .djs-visual {
  fill: var(--bendpoint-fill-color);
  stroke: var(--bendpoint-stroke-color);
  stroke-opacity: 1;
}

.djs-bendpoint.floating .djs-hit {
  pointer-events: none;
}

.djs-segment-dragger .djs-hit,
.djs-bendpoint .djs-hit {
  fill: none;
  pointer-events: all;
}

.djs-segment-dragger.horizontal .djs-hit {
  cursor: ns-resize;
}

.djs-segment-dragger.vertical .djs-hit {
  cursor: ew-resize;
}

.djs-segment-dragger.djs-dragging .djs-hit {
  pointer-events: none;
}

.djs-updating,
.djs-updating > * {
  pointer-events: none !important;
}

.djs-updating .djs-context-pad,
.djs-updating .djs-outline,
.djs-updating .djs-bendpoint,
.djs-multi-select .djs-bendpoint,
.djs-multi-select .djs-segment-dragger,
.connect-ok .djs-bendpoint,
.connect-not-ok .djs-bendpoint,
.drop-ok .djs-bendpoint,
.drop-not-ok .djs-bendpoint {
  display: none !important;
}

.djs-segment-dragger.djs-dragging,
.djs-bendpoint.djs-dragging {
  display: block;
  opacity: 1.0;
}


/**
 * tooltips
 */
.djs-tooltip-error {
  width: 160px;
  padding: 6px;

  background: var(--tooltip-error-background-color);
  border: solid 1px var(--tooltip-error-border-color);
  border-radius: var(--surface-border-radius);
  color: var(--tooltip-error-color);
  font-size: 12px;
  line-height: 16px;

  opacity: 0.75;
}

.djs-tooltip-error:hover {
  opacity: 1;
}


/**
 * search pad
 */
.djs-search-open .djs-context-pad {
  display: none;
}

.djs-search-open .djs-connection.selected .djs-outline {
  display: block;
}

.djs-search-container {
  position: absolute;
  top: 20px;
  left: 0;
  right: 0;
  margin-left: auto;
  margin-right: auto;

  width: 25%;
  min-width: 300px;
  max-width: 400px;
  z-index: 10;

  font-family: var(--search-font-family);
  font-size: var(--search-font-size);
  border-radius: var(--surface-border-radius);
  box-shadow: 0px 2px 6px var(--search-shadow-color);
}

.djs-search-container:not(.open) {
  display: none;
}

.djs-search-input {
  position: relative;
}

.djs-search-input svg {
  position: absolute;
  left: 8px;
  top: 7px;
}

.djs-search-input input {
  font-size: var(--search-font-size);
  width: 100%;
  padding: 3px 6px 3px 28px;
  border: 1px solid var(--search-input-border-color);
  border-radius: var(--input-border-radius);
  box-sizing: border-box;
  line-height: 21px;
}

.djs-search-input input:focus {
  background-color: var(--search-input-focus-background-color);
  border: solid 1px var(--search-input-focus-border-color);
  outline: none;
}

.djs-search-results {
  position: relative;
  overflow-y: auto;
  max-height: 200px;
  background: var(--search-container-background-color);
}

.djs-search-result {
  padding: 6px 8px;
}

.djs-search-result-primary {
  margin: 0 0 3px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.djs-search-result-secondary {
  font-family: monospace;
  margin: 0;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  color: var(--search-result-secondary-color);
}

.djs-search-result:hover {
  background: var(--search-result-hover-background-color);
}

.djs-search-result-selected {
  background: var(--search-result-hover-background-color);
}

.djs-search-result-selected:hover {
  background: var(--search-result-hover-background-color);
}

.djs-search-open .djs-element .djs-outline {
  fill: var(--search-preselected-background-color) !important;
}

/**
 * hidden styles
 */
.djs-element-hidden,
.djs-element-hidden .djs-hit,
.djs-element-hidden .djs-outline,
.djs-label-hidden .djs-label {
  display: none !important;
}

.djs-element .djs-hit-stroke,
.djs-element .djs-hit-click-stroke,
.djs-element .djs-hit-all {
  cursor: move;
}
/**
 * Semantic tokens, copied from \`@bpmn-io/theme\` to style the components
 * according to this theme.
 *
 * Names and values of the tokens should stay intact with the \`@bpmn-io/theme\`
 * source of truth, to ensure matching styles and allow overrides with an
 * alternative theme.
 */
.bio-theme-parent {
  --bio-surface-subtle: hsl(225, 10%, 97%);
  --bio-text-on-primary: hsl(0, 0%, 100%);
  --bio-border: hsl(225, 10%, 75%);
  --bio-primary: hsl(205, 100%, 40%);
  --bio-focus: hsl(205, 100%, 40%);
  --bio-radius-md: 3px;
  --bio-radius-lg: 4px;
}

.bjs-container {
  --bjs-font-family: Arial, sans-serif;

  --accent-color: var(--bio-primary);

  --breadcrumbs-font-family: var(--bjs-font-family);
  --breadcrumbs-item-color: var(--accent-color);
  --breadcrumbs-background-color: var(--bio-surface-subtle);
  --breadcrumbs-border-color: var(--bio-border);
  --breadcrumbs-focus-outline-color: var(--bio-focus);
  --drilldown-fill-color: var(--bio-text-on-primary);
  --drilldown-background-color: var(--accent-color);
  --drilldown-focus-outline-color: var(--bio-focus);

  --button-border-radius: var(--bio-radius-md);
  --surface-border-radius: var(--bio-radius-lg);
}

.bjs-breadcrumbs {
  position: absolute;
  display: none;
  flex-wrap: wrap;
  align-items: center;
  top: 20px;
  left: 20px;
  padding: 5px 10px;
  margin: 0px;
  font-family: var(--breadcrumbs-font-family);
  font-size: 16px;
  line-height: normal;
  background-color: var(--breadcrumbs-background-color);
  border: solid 1px var(--breadcrumbs-border-color);
  border-radius: var(--surface-border-radius);
  row-gap: 5px;
}

.bjs-breadcrumbs-shown .bjs-breadcrumbs {
  display: flex;
}

.djs-palette-shown .bjs-breadcrumbs {
  left: 90px;
}

.djs-palette-shown.djs-palette-two-column .bjs-breadcrumbs {
  left: 140px;
}

.bjs-breadcrumbs li {
  display: inline-flex;
  align-items: center;
}

.bjs-breadcrumbs a.bjs-crumb {
  cursor: pointer;
  color: var(--breadcrumbs-item-color);
  text-decoration: none;
}

.bjs-breadcrumbs a.bjs-crumb:focus-visible {
  outline: solid 1px var(--breadcrumbs-focus-outline-color);
  outline-offset: 1px;
}

.bjs-breadcrumbs li:not(:first-child)::before {
  content: url('__ASSET__inline-01.svg');
  padding: 0 8px;
  height: 1em;
}

.bjs-breadcrumbs .bjs-crumb {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bjs-drilldown {
  width: 20px;
  height: 20px;

  padding: 0px;
  margin-left: -20px;

  cursor: pointer;
  border: none;
  border-radius: var(--button-border-radius);

  fill: var(--drilldown-fill-color);
  background-color: var(--drilldown-background-color);
}

.bjs-drilldown:focus-visible {
  outline: solid 1px var(--drilldown-focus-outline-color);
  outline-offset: 1px;
}

.bjs-drilldown-empty {
  display: none;
}

.selected .bjs-drilldown-empty {
  display: inherit;
}

[data-popup="align-elements"] .djs-popup-results {
  display: flex;
}

[data-popup="align-elements"] .djs-popup-body [data-group] + [data-group] {
  border-left: 1px solid var(--popup-border-color);
}

[data-popup="align-elements"] [data-group="align"] {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

[data-popup="align-elements"] .djs-popup-body .entry {
  padding: 6px 8px;
}

[data-popup="align-elements"] .djs-popup-body .entry:not(:first-child) {
  margin-top: 0;
}

[data-popup="align-elements"] .djs-popup-entry-icon {
  display: block;
  margin: 0;
  height: 20px;
  width: 20px;
}

[class^="bpmn-icon-"]:before, [class*=" bpmn-icon-"]:before {
  font-family: "bpmn";
  font-style: normal;
  font-weight: normal;
  speak: never;

  display: inline-block;
  text-decoration: inherit;
  width: 1em;
  
  text-align: center;
  

  
  font-variant: normal;
  text-transform: none;

  
  line-height: 1em;

  
  
  

  
  

  
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  
  
}

.bpmn-icon-trash:before { content: '\\e801'; } 
.bpmn-icon-gateway-parallel:before { content: '\\e804'; } 
.bpmn-icon-intermediate-event-catch-cancel:before { content: '\\e805'; } 
.bpmn-icon-intermediate-event-catch-non-interrupting-message:before { content: '\\e806'; } 
.bpmn-icon-start-event-compensation:before { content: '\\e807'; } 
.bpmn-icon-start-event-non-interrupting-parallel-multiple:before { content: '\\e808'; } 
.bpmn-icon-loop-marker:before { content: '\\e809'; } 
.bpmn-icon-parallel-mi-marker:before { content: '\\e80a'; } 
.bpmn-icon-start-event-non-interrupting-signal:before { content: '\\e80b'; } 
.bpmn-icon-intermediate-event-catch-non-interrupting-timer:before { content: '\\e80c'; } 
.bpmn-icon-intermediate-event-catch-parallel-multiple:before { content: '\\e80d'; } 
.bpmn-icon-intermediate-event-catch-compensation:before { content: '\\e80e'; } 
.bpmn-icon-gateway-xor:before { content: '\\e80f'; } 
.bpmn-icon-end-event-cancel:before { content: '\\e811'; } 
.bpmn-icon-intermediate-event-catch-condition:before { content: '\\e812'; } 
.bpmn-icon-intermediate-event-catch-non-interrupting-parallel-multiple:before { content: '\\e813'; } 
.bpmn-icon-start-event-condition:before { content: '\\e814'; } 
.bpmn-icon-start-event-non-interrupting-timer:before { content: '\\e815'; } 
.bpmn-icon-sequential-mi-marker:before { content: '\\e816'; } 
.bpmn-icon-user-task:before { content: '\\e817'; } 
.bpmn-icon-business-rule:before { content: '\\e818'; } 
.bpmn-icon-sub-process-marker:before { content: '\\e819'; } 
.bpmn-icon-start-event-parallel-multiple:before { content: '\\e81a'; } 
.bpmn-icon-start-event-error:before { content: '\\e81b'; } 
.bpmn-icon-intermediate-event-catch-signal:before { content: '\\e81c'; } 
.bpmn-icon-intermediate-event-catch-error:before { content: '\\e81d'; } 
.bpmn-icon-end-event-compensation:before { content: '\\e81e'; } 
.bpmn-icon-subprocess-collapsed:before { content: '\\e81f'; } 
.bpmn-icon-subprocess-expanded:before { content: '\\e820'; } 
.bpmn-icon-task:before { content: '\\e821'; } 
.bpmn-icon-end-event-error:before { content: '\\e822'; } 
.bpmn-icon-intermediate-event-catch-escalation:before { content: '\\e823'; } 
.bpmn-icon-intermediate-event-catch-timer:before { content: '\\e824'; } 
.bpmn-icon-start-event-escalation:before { content: '\\e825'; } 
.bpmn-icon-start-event-signal:before { content: '\\e826'; } 
.bpmn-icon-business-rule-task:before { content: '\\e827'; } 
.bpmn-icon-manual:before { content: '\\e828'; } 
.bpmn-icon-receive:before { content: '\\e829'; } 
.bpmn-icon-call-activity:before { content: '\\e82a'; } 
.bpmn-icon-start-event-timer:before { content: '\\e82b'; } 
.bpmn-icon-start-event-message:before { content: '\\e82c'; } 
.bpmn-icon-intermediate-event-none:before { content: '\\e82d'; } 
.bpmn-icon-intermediate-event-catch-link:before { content: '\\e82e'; } 
.bpmn-icon-end-event-escalation:before { content: '\\e82f'; } 
.bpmn-icon-bpmn-io:before { content: '\\e831'; } 
.bpmn-icon-gateway-complex:before { content: '\\e832'; } 
.bpmn-icon-gateway-eventbased:before { content: '\\e833'; } 
.bpmn-icon-gateway-none:before { content: '\\e834'; } 
.bpmn-icon-gateway-or:before { content: '\\e835'; } 
.bpmn-icon-end-event-terminate:before { content: '\\e836'; } 
.bpmn-icon-end-event-signal:before { content: '\\e837'; } 
.bpmn-icon-end-event-none:before { content: '\\e838'; } 
.bpmn-icon-end-event-multiple:before { content: '\\e839'; } 
.bpmn-icon-end-event-message:before { content: '\\e83a'; } 
.bpmn-icon-end-event-link:before { content: '\\e83b'; } 
.bpmn-icon-intermediate-event-catch-message:before { content: '\\e83c'; } 
.bpmn-icon-intermediate-event-throw-compensation:before { content: '\\e83d'; } 
.bpmn-icon-start-event-multiple:before { content: '\\e83e'; } 
.bpmn-icon-script:before { content: '\\e83f'; } 
.bpmn-icon-manual-task:before { content: '\\e840'; } 
.bpmn-icon-send:before { content: '\\e841'; } 
.bpmn-icon-service:before { content: '\\e842'; } 
.bpmn-icon-receive-task:before { content: '\\e843'; } 
.bpmn-icon-user:before { content: '\\e844'; } 
.bpmn-icon-start-event-none:before { content: '\\e845'; } 
.bpmn-icon-intermediate-event-throw-escalation:before { content: '\\e846'; } 
.bpmn-icon-intermediate-event-catch-multiple:before { content: '\\e847'; } 
.bpmn-icon-intermediate-event-catch-non-interrupting-escalation:before { content: '\\e848'; } 
.bpmn-icon-intermediate-event-throw-link:before { content: '\\e849'; } 
.bpmn-icon-start-event-non-interrupting-condition:before { content: '\\e84a'; } 
.bpmn-icon-data-object:before { content: '\\e84b'; } 
.bpmn-icon-script-task:before { content: '\\e84c'; } 
.bpmn-icon-send-task:before { content: '\\e84d'; } 
.bpmn-icon-data-store:before { content: '\\e84e'; } 
.bpmn-icon-start-event-non-interrupting-escalation:before { content: '\\e84f'; } 
.bpmn-icon-intermediate-event-throw-message:before { content: '\\e850'; } 
.bpmn-icon-intermediate-event-catch-non-interrupting-multiple:before { content: '\\e851'; } 
.bpmn-icon-intermediate-event-catch-non-interrupting-signal:before { content: '\\e852'; } 
.bpmn-icon-intermediate-event-throw-multiple:before { content: '\\e853'; } 
.bpmn-icon-start-event-non-interrupting-message:before { content: '\\e854'; } 
.bpmn-icon-ad-hoc-marker:before { content: '\\e855'; } 
.bpmn-icon-service-task:before { content: '\\e856'; } 
.bpmn-icon-task-none:before { content: '\\e857'; } 
.bpmn-icon-compensation-marker:before { content: '\\e858'; } 
.bpmn-icon-start-event-non-interrupting-multiple:before { content: '\\e859'; } 
.bpmn-icon-intermediate-event-throw-signal:before { content: '\\e85a'; } 
.bpmn-icon-intermediate-event-catch-non-interrupting-condition:before { content: '\\e85b'; } 
.bpmn-icon-participant:before { content: '\\e85c'; } 
.bpmn-icon-event-subprocess-expanded:before { content: '\\e85d'; } 
.bpmn-icon-lane-insert-below:before { content: '\\e85e'; } 
.bpmn-icon-space-tool:before { content: '\\e85f'; } 
.bpmn-icon-connection-multi:before { content: '\\e860'; } 
.bpmn-icon-lane:before { content: '\\e861'; } 
.bpmn-icon-lasso-tool:before { content: '\\e862'; } 
.bpmn-icon-lane-insert-above:before { content: '\\e863'; } 
.bpmn-icon-lane-divide-three:before { content: '\\e864'; } 
.bpmn-icon-lane-divide-two:before { content: '\\e865'; } 
.bpmn-icon-data-input:before { content: '\\e866'; } 
.bpmn-icon-data-output:before { content: '\\e867'; } 
.bpmn-icon-hand-tool:before { content: '\\e868'; } 
.bpmn-icon-group:before { content: '\\e869'; } 
.bpmn-icon-text-annotation:before { content: '\\e86b'; } 
.bpmn-icon-event-subprocess-collapsed:before { content: '\\e8c3'; } 
.bpmn-icon-transaction:before { content: '\\e8c4'; } 
.bpmn-icon-ad-hoc-subprocess:before { content: '\\e8c5'; } 
.bpmn-icon-screw-wrench:before { content: '\\e8db'; } 
.bpmn-icon-connection:before { content: '\\e8dc'; } 
.bpmn-icon-conditional-flow:before { content: '\\e8e0'; } 
.bpmn-icon-default-flow:before { content: '\\e8e1'; }
.bpmn-canvas {
  /* Read by the canvas to detect styles that never arrived (diagnostic styles-missing). */
  --bpmn-canvas-styles: 1;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  outline: none;
}

.bpmn-canvas:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}

.bpmn-canvas--readonly .djs-palette,
.bpmn-canvas--readonly .djs-context-pad {
  display: none;
}

/* Hidden only when the host asked for it and named its license (options.watermark). */
.bpmn-canvas[data-bpmn-canvas-watermark="hidden"] .bjs-powered-by {
  display: none !important;
}

/*
 * Legend palette (profile "legend" only). Every rule is scoped to entries whose data-action starts
 * with "legend.", so the default palette of the "standard" profile is never touched.
 * Icons are monochrome masks authored for this package; the colour comes from
 * --bpmn-canvas-legend-icon (default #333333), the hover ring from --bpmn-canvas-legend-accent.
 * Action ids are listed in the README ("Legend profile").
 */

.djs-palette:has(.entry[data-action^="legend."]) {
  border-radius: 6px;
}

.djs-palette .entry[data-action^="legend."] {
  width: 40px;
  height: 40px;
  line-height: 40px;
  margin: 2px;
  border-radius: 4px;
  transition: box-shadow 0.12s ease;
}

.djs-palette .entry[data-action^="legend."]::before {
  content: "";
  display: block;
  width: 26px;
  height: 26px;
  margin: 7px;
  font: normal 0/0 sans-serif;
  background-color: var(--bpmn-canvas-legend-icon, #333333);
  -webkit-mask: var(--bpmn-canvas-legend-glyph) center / 26px 26px no-repeat;
  mask: var(--bpmn-canvas-legend-glyph) center / 26px 26px no-repeat;
}

.djs-palette .entry[data-action^="legend."]:hover,
.djs-palette .highlighted-entry[data-action^="legend."] {
  box-shadow: 0 0 0 2px var(--bpmn-canvas-legend-accent, #4a6fa5);
}

.djs-palette .entry[data-action="legend.start"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-02.svg");
}

.djs-palette .entry[data-action="legend.end"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-03.svg");
}

.djs-palette .entry[data-action="legend.intermediate-event"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-04.svg");
}

.djs-palette .entry[data-action="legend.task"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-05.svg");
}

.djs-palette .entry[data-action="legend.subprocess"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-06.svg");
}

.djs-palette .entry[data-action="legend.external-process"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-07.svg");
}

.djs-palette .entry[data-action="legend.gateway-or"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-08.svg");
}

.djs-palette .entry[data-action="legend.gateway-and"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-09.svg");
}

.djs-palette .entry[data-action="legend.data-input"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-10.svg");
}

.djs-palette .entry[data-action="legend.data-output"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-11.svg");
}

.djs-palette .entry[data-action="legend.external-input"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-12.svg");
}

.djs-palette .entry[data-action="legend.process-output"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-13.svg");
}

.djs-palette .entry[data-action="legend.document"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-14.svg");
}

.djs-palette .entry[data-action="legend.application"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-15.svg");
}

.djs-palette .entry[data-action="legend.lane"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-16.svg");
}

.djs-palette .entry[data-action="legend.sequence-flow"] {
  --bpmn-canvas-legend-glyph: url("__ASSET__inline-17.svg");
}

/*
 * Navigation markers (collapsed sub-process [+], external process icon). diagram-js draws a transparent
 * hit rectangle over the whole element; without these rules it swallows every click and a marker can never
 * be the event target. With them, a click on the body targets the body, a click on the marker targets the marker.
 */
.legend-marker {
  cursor: pointer;
  pointer-events: all;
}

.djs-element:has(.legend-marker) > .djs-hit-all {
  pointer-events: none;
}

.djs-element:has(.legend-marker) > .djs-visual,
.djs-element:has(.legend-marker) > .djs-visual > * {
  pointer-events: auto;
}

.djs-element:has(.legend-marker) > .djs-visual > .legend-task {
  cursor: move;
}

/*
 * Token-driven palette colours. The variables --bpmn-canvas-icon-<group> are set per canvas instance from the
 * profile tokens (see src/internal/palette.ts). Without tokens every rule falls back to the neutral values
 * below, so a canvas without tokens renders as before. The standard profile is never touched: the upstream
 * rules are scoped to .bpmn-canvas--colored, which only the colored profile (with tokens) adds.
 */

.djs-palette .entry[data-action="legend.start"]::before {
  background-color: var(--bpmn-canvas-icon-start, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.end"]::before {
  background-color: var(--bpmn-canvas-icon-end, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.intermediate-event"]::before {
  background-color: var(--bpmn-canvas-icon-intermediate, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.task"]::before {
  background-color: var(--bpmn-canvas-icon-task, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.subprocess"]::before {
  background-color: var(--bpmn-canvas-icon-subprocess, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.external-process"]::before {
  background-color: var(--bpmn-canvas-icon-external, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.gateway-or"]::before {
  background-color: var(--bpmn-canvas-icon-gateway, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.gateway-and"]::before {
  background-color: var(--bpmn-canvas-icon-gateway, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.data-input"]::before {
  background-color: var(--bpmn-canvas-icon-data, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.data-output"]::before {
  background-color: var(--bpmn-canvas-icon-data, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.external-input"]::before {
  background-color: var(--bpmn-canvas-icon-external, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.process-output"]::before {
  background-color: var(--bpmn-canvas-icon-external, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.document"]::before {
  background-color: var(--bpmn-canvas-icon-document, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.application"]::before {
  background-color: var(--bpmn-canvas-icon-application, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.lane"]::before {
  background-color: var(--bpmn-canvas-icon-lane, var(--bpmn-canvas-legend-icon, #333333));
}

.djs-palette .entry[data-action="legend.sequence-flow"]::before {
  background-color: var(--bpmn-canvas-icon-flow, var(--bpmn-canvas-legend-icon, #333333));
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.start-event"] {
  color: var(--bpmn-canvas-icon-start);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.intermediate-event"] {
  color: var(--bpmn-canvas-icon-intermediate);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.end-event"] {
  color: var(--bpmn-canvas-icon-end);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.exclusive-gateway"] {
  color: var(--bpmn-canvas-icon-gateway);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.task"] {
  color: var(--bpmn-canvas-icon-task);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.data-object"] {
  color: var(--bpmn-canvas-icon-data);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.data-store"] {
  color: var(--bpmn-canvas-icon-data);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.subprocess-expanded"] {
  color: var(--bpmn-canvas-icon-subprocess);
}

.bpmn-canvas--colored .djs-palette .entry[data-action="create.participant-expanded"] {
  color: var(--bpmn-canvas-icon-pool);
}


/* Workshop primitives: menu and tabs. Themed by custom properties; neutral light defaults,
   a dark set under prefers-color-scheme, and system colours in forced-colors mode. */
.bpmn-workshop,
.bpmn-workshop-menu,
.bpmn-workshop-tabs {
  --bpmn-workshop-bg: #ffffff;
  --bpmn-workshop-fg: #1f2328;
  --bpmn-workshop-muted: #57606a;
  --bpmn-workshop-border: #8c959f;
  --bpmn-workshop-accent: #0550ae;
  --bpmn-workshop-focus: #0969da;
  --bpmn-workshop-hover: #eaeef2;
  --bpmn-workshop-radius: 6px;
}

@media (prefers-color-scheme: dark) {
  .bpmn-workshop,
  .bpmn-workshop-menu,
  .bpmn-workshop-tabs {
    --bpmn-workshop-bg: #1f2328;
    --bpmn-workshop-fg: #e6edf3;
    --bpmn-workshop-muted: #9da7b3;
    --bpmn-workshop-border: #6e7681;
    --bpmn-workshop-accent: #79c0ff;
    --bpmn-workshop-focus: #58a6ff;
    --bpmn-workshop-hover: #30363d;
  }
}

.bpmn-workshop-menu {
  position: relative;
  display: inline-block;
  font: inherit;
  color: var(--bpmn-workshop-fg);
}

.bpmn-workshop-menu__trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  color: var(--bpmn-workshop-fg);
  background: var(--bpmn-workshop-bg);
  border: 1px solid var(--bpmn-workshop-border);
  border-radius: var(--bpmn-workshop-radius);
  padding: 4px 8px;
  cursor: pointer;
}

.bpmn-workshop-menu__trigger:disabled {
  color: var(--bpmn-workshop-muted);
  cursor: not-allowed;
  opacity: 0.7;
}

.bpmn-workshop-menu__popup {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  z-index: 20;
  min-width: 100%;
  width: max-content;
  max-width: min(320px, 90vw);
  padding: 4px;
  background: var(--bpmn-workshop-bg);
  color: var(--bpmn-workshop-fg);
  border: 1px solid var(--bpmn-workshop-border);
  border-radius: var(--bpmn-workshop-radius);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
}

.bpmn-workshop-menu__popup[hidden] {
  display: none;
}

.bpmn-workshop-menu__item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  font: inherit;
  text-align: left;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: calc(var(--bpmn-workshop-radius) - 2px);
  padding: 6px 8px;
  cursor: pointer;
}

.bpmn-workshop-menu__item:hover,
.bpmn-workshop-menu__item:focus {
  background: var(--bpmn-workshop-hover);
}

.bpmn-workshop-menu__item[aria-disabled="true"] {
  color: var(--bpmn-workshop-muted);
  cursor: not-allowed;
}

.bpmn-workshop-menu__mark {
  display: inline-flex;
  width: 16px;
  flex: none;
  color: var(--bpmn-workshop-accent);
}

.bpmn-workshop-menu__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.bpmn-workshop-menu__desc {
  font-size: 0.85em;
  color: var(--bpmn-workshop-muted);
  white-space: normal;
}

.bpmn-workshop-tabs {
  display: flex;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--bpmn-workshop-border);
  font: inherit;
  color: var(--bpmn-workshop-fg);
}

.bpmn-workshop-tabs__tab {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 220px;
  font: inherit;
  color: var(--bpmn-workshop-muted);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: var(--bpmn-workshop-radius) var(--bpmn-workshop-radius) 0 0;
  padding: 6px 10px;
  cursor: pointer;
}

.bpmn-workshop-tabs__tab[aria-selected="true"] {
  color: var(--bpmn-workshop-fg);
  border-bottom-color: var(--bpmn-workshop-accent);
  font-weight: 600;
}

.bpmn-workshop-tabs__tab:hover {
  background: var(--bpmn-workshop-hover);
}

.bpmn-workshop-tabs__label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bpmn-workshop-menu__trigger:focus-visible,
.bpmn-workshop-menu__item:focus-visible,
.bpmn-workshop-tabs__tab:focus-visible {
  outline: 2px solid var(--bpmn-workshop-focus);
  outline-offset: 1px;
}

@media (forced-colors: active) {
  .bpmn-workshop-menu__trigger,
  .bpmn-workshop-menu__popup {
    border-color: CanvasText;
  }
  .bpmn-workshop-menu__item:focus,
  .bpmn-workshop-tabs__tab[aria-selected="true"] {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
  .bpmn-workshop-tabs {
    border-bottom-color: CanvasText;
  }
}

/* Shell of the BPMN workshop: toolbar, buttons, notices, panel, canvas and the busy veil.
   Themed by the same custom properties as the primitives (see workshop.css). */
.bpmn-workshop {
  --bw-bg: var(--bpmn-workshop-bg, #ffffff);
  --bw-fg: var(--bpmn-workshop-fg, #1f2328);
  --bw-border: var(--bpmn-workshop-border, #6b7280);
  --bw-muted: var(--bpmn-workshop-muted, #4b5563);
  --bw-accent: var(--bpmn-workshop-accent, #0b5cad);
  --bw-focus: var(--bpmn-workshop-focus, #0b5cad);
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  height: 100%;
  background: var(--bw-bg);
  color: var(--bw-fg);
  font: inherit;
}

.bpmn-workshop__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--bw-border);
}

.bpmn-workshop__button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  min-width: 28px;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: var(--bpmn-workshop-radius, 6px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.bpmn-workshop__button:hover:not(:disabled) {
  border-color: var(--bw-border);
  background: color-mix(in srgb, var(--bw-fg) 8%, transparent);
}

.bpmn-workshop__button:focus-visible {
  outline: 2px solid var(--bw-focus);
  outline-offset: 1px;
}

.bpmn-workshop__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bpmn-workshop__notices {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--bw-border);
}

.bpmn-workshop__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 6px;
  border-left: 3px solid var(--bw-accent);
  font-size: 0.9em;
}

.bpmn-workshop__notice--error {
  border-left-color: #b42318;
}

.bpmn-workshop__notice--warning {
  border-left-color: #a15c00;
}

.bpmn-workshop__panel {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.bpmn-workshop__panel:focus-visible {
  outline: 2px solid var(--bw-focus);
  outline-offset: -2px;
}

.bpmn-workshop__canvas {
  position: absolute;
  inset: 0;
}

.bpmn-workshop__veil {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12px;
  background: color-mix(in srgb, var(--bw-bg) 55%, transparent);
  pointer-events: all;
}

.bpmn-workshop__busy {
  padding: 4px 10px;
  border: 1px solid var(--bw-border);
  border-radius: 999px;
  background: var(--bw-bg);
  color: var(--bw-fg);
  font-size: 0.9em;
}

/* While busy the palette is hidden and nothing can be picked. */
.bpmn-workshop--busy .djs-palette,
.bpmn-workshop--busy .djs-context-pad {
  display: none;
}

@media (prefers-color-scheme: dark) {
  .bpmn-workshop {
    --bw-bg: var(--bpmn-workshop-bg, #0d1117);
    --bw-fg: var(--bpmn-workshop-fg, #e6edf3);
    --bw-border: var(--bpmn-workshop-border, #8b949e);
    --bw-muted: var(--bpmn-workshop-muted, #9aa4ae);
    --bw-accent: var(--bpmn-workshop-accent, #58a6ff);
    --bw-focus: var(--bpmn-workshop-focus, #58a6ff);
  }
}
`,Ut=new WeakSet,Wt=new Map;function Gt(e){let t=e?.href??``,n=Wt.get(t);return n===void 0&&(n=Ht.split(Vt).map((t,n)=>{if(n===0)return t;let r=/^inline-\d{2}\.svg/.exec(t)?.[0];if(!r)throw Error(`unknown inline asset in the generated CSS`);return Zt(r,e)+t.slice(r.length)}).join(``),Wt.set(t,n)),n}var Kt=`data-bpmn-canvas-font`,qt=`data-bpmn-canvas-styles`;function Jt(e){let t=t=>e?new URL(`bpmn-font/font/${t}`,e).href:``;return`@font-face{font-family:'bpmn';src:url('${e?t(`bpmn.woff2`):new URL(`/assets/bpmn-DaJ2be00.woff2`,``+import.meta.url).href}') format('woff2'),url('${e?t(`bpmn.woff`):new URL(`/assets/bpmn-DaGVGZ7K.woff`,``+import.meta.url).href}') format('woff'),url('${e?t(`bpmn.ttf`):new URL(`/assets/bpmn-CZlEAdL6.ttf`,``+import.meta.url).href}') format('truetype');font-weight:normal;font-style:normal;}`}function Yt(e){let t=new URL(e);if(!/^(https?|file):$/.test(t.protocol))throw Error(`assetBase must be an absolute http(s) URL, got ${e}`);if(t.search||t.hash)throw Error(`assetBase must name a directory, without query or fragment, got ${e}`);return t.pathname.endsWith(`/`)||(t.pathname+=`/`),t}function Xt(e){return e?new URL(`bpmn-font/font/bpmn.woff2`,e).href:new URL(`/assets/bpmn-DaJ2be00.woff2`,``+import.meta.url).href}function Zt(e,t){if(t)return new URL(`inline/${e}`,t).href;let n=Bt()[e];if(!n)throw Error(`unknown inline asset ${e}`);return n}function Qt(e,t,n,r){let i=(e.ownerDocument??e).createElement(`style`);i.setAttribute(t,``),r&&i.setAttribute(`nonce`,r),i.textContent=n,e.appendChild(i)}function $t(e,t,n){let r=e.getRootNode(),i=e.ownerDocument;Ut.has(i)||(Ut.add(i),i.head.querySelector(`style[${Kt}]`)||Qt(i.head,Kt,Jt(n),t));let a=r instanceof ShadowRoot?r:i.head;Ut.has(a)||(Ut.add(a),(a instanceof ShadowRoot||!i.head.querySelector(`style[${qt}]`))&&Qt(a,qt,Gt(n),t))}var en=.85,Y=24;function tn(e){if(e.length===0)return null;let t=1/0,n=1/0,r=-1/0,i=-1/0;for(let a of e)t=Math.min(t,a.x),n=Math.min(n,a.y),r=Math.max(r,a.x+a.width),i=Math.max(i,a.y+a.height);return{x:t,y:n,width:r-t,height:i-n}}var nn=new Set([`bpmn:Participant`,`bpmn:Lane`,`label`]);function rn(e){let t=e.find(e=>e.type===`bpmn:StartEvent`);if(t)return t;let n=e.filter(e=>!nn.has(e.type));return n.length===0?null:n.reduce((e,t)=>t.x<e.x||t.x===e.x&&t.y<e.y?t:e)}function an(e,t,n=0,r=!1){let i=tn(e),a=t.width-n-48;if(!i||a<=0||t.height<=0)return null;let o=Math.min(a/(i.width+2*Y),t.height/(i.height+2*Y));if(r||o>=.6){let e=Math.min(o,1),r=t.width/e,a=t.height/e;return{mode:`fit`,scale:e,viewbox:{x:i.x-Y-n/e,y:i.y+i.height/2-a/2,width:r,height:a}}}let s=en,c=t.width/s,l=t.height/s,u=n/s,d=rn(e)??i,f=i.x-Y-u;d.x+d.width>f+u+(c-u)*.5&&(f=d.x-u-(c-u)*.2);let p=Math.max(i.y-Y,d.y+d.height/2-l/3);return p=Math.min(p,Math.max(i.y-Y,i.y+i.height+Y-l)),{mode:`anchor`,viewbox:{x:f,y:p,width:c,height:l},scale:s}}function X(){let e=Error(`Operation aborted: superseded or canvas destroyed`);return e.name=`AbortError`,e}var on=`.bjs-drilldown, [data-marker='sub-process'], [data-marker='process-icon'], .legend-marker`,sn={standard:56,legend:112,colored:56},cn=1.15,ln=.87,un=.2,dn=4,fn=class{ready;instanceId=Mt();root;host;options;modeler;_state=`loading`;destroyed=!1;epoch=0;navSeq=0;queue=Promise.resolve();loading=0;touched=!1;inputXml=``;baseRevision;revisionCounter=0;lastRevision;activeId;diagrams=[];planeIds=new Map;diagnostics=[];hostReadOnly;lossyGate=!1;inLayout=!1;wheelListener;wheelCapture=!1;drilldownListener;abortListener;profileId;tokens;fitMode;fittedOnce=!1;resizeObserver;lastSize=``;lastHistory=``;watermarkRefusal;assetProblems=[];assetBase;assetsChecked=!1;history={past:[],future:[]};capturing=!1;constructor(e,t){this.host=e,this.options=t,this.hostReadOnly=t.readOnly===!0,this.profileId=t.profile??`standard`,this.tokens=t.profile===`colored`?t.coloredTokens:t.legendTokens,this.fitMode=t.fitMode??`readable`,this.baseRevision=t.revision,this.root=e.ownerDocument.createElement(`div`),this.root.className=`bpmn-canvas`,this.root.dataset.bpmnCanvasInstance=this.instanceId,t.watermark?.hidden===!0&&(String(t.watermark.license??``).trim()===``?this.watermarkRefusal={code:`watermark-refused`,severity:`warning`,message:`The bpmn.io logo stays visible: hiding it needs watermark.license, the reference of the license that allows it.`}:this.root.dataset.bpmnCanvasWatermark=`hidden`),e.appendChild(this.root);let n=[];if(t.assetBase!==void 0)try{this.assetBase=Yt(t.assetBase)}catch(e){n.push({code:`asset-load-failed`,severity:`error`,message:`assetBase is not usable (${hn(e)}); fonts and images are looked up next to the bundle instead.`})}if((t.styles??`auto`)===`auto`)try{$t(e,t.styleNonce,this.assetBase)}catch(e){n.push({code:`styles-missing`,severity:`error`,message:`The canvas styles could not be installed (${hn(e)}). Set assetBase to the absolute URL of the package's dist/assets/ directory.`})}t.signal&&(t.signal.aborted?this.destroy():(this.abortListener=()=>this.destroy(),t.signal.addEventListener(`abort`,this.abortListener,{once:!0})));let r=++this.epoch;if(this.queue=this.init(),this.watermarkRefusal){let e=this.watermarkRefusal;Promise.resolve().then(()=>{this.destroyed||this.emit(e)})}for(let e of n)Promise.resolve().then(()=>this.reportAsset(e));let i=t.xml===void 0?this.queue:this.enqueue(r,()=>this.applyXml(t.xml,t.revision,r));this.ready=i.then(()=>void 0,()=>void 0)}get state(){return this._state}setState(e){this._state!==e&&(this._state=e,this.options.onStateChange?.(e))}emit(e){this.options.onDiagnostic?.(e)}reportAsset(e){if(this.destroyed)return;this.assetProblems.push(e),this.emit(e);let t=this.root.ownerDocument,n=this.root.querySelector(`:scope > .bpmn-canvas__asset-notice`);n||(n=t.createElement(`div`),n.className=`bpmn-canvas__asset-notice`,n.setAttribute(`role`,`alert`),Object.assign(n.style,{position:`absolute`,left:`8px`,right:`8px`,top:`8px`,zIndex:`10`,pointerEvents:`none`,padding:`8px 10px`,background:`#fff4e5`,color:`#5f3700`,border:`1px solid #e0a050`,borderRadius:`4px`,font:`13px/1.4 system-ui, sans-serif`}),this.root.style.position=`relative`,this.root.append(n));let r=t.createElement(`div`);r.textContent=`BPMN canvas: ${e.message}`,n.append(r),this.root.getBoundingClientRect().height<64&&(this.root.style.minHeight=`120px`)}scheduleAssetCheck(){this.assetsChecked||(this.assetsChecked=!0,this.checkAssets().catch(()=>void 0))}async checkAssets(){let e=this.root.ownerDocument,t=e.defaultView,n=e.fonts;if(!t||!n)return;let r=this.options.styles===`external`,i=()=>t.getComputedStyle(this.root).getPropertyValue(`--bpmn-canvas-styles`).trim()===`1`;if(i()||await gn(t,5e3),this.destroyed||this.assetProblems.some(e=>e.code===`styles-missing`))return;if(!i()){this.reportAsset({code:`styles-missing`,severity:`error`,message:r?`the stylesheet is not applied: load styles.css from the package, or use styles: "auto".`:`the styles are not applied: a Content-Security-Policy may block them (pass styleNonce).`});return}let a=!1;try{let e=await n.load(`14px bpmn`);a=e.length>0&&e.every(e=>e.status===`loaded`)}catch{a=!1}if(this.destroyed)return;let o=r?`next to styles.css`:this.assetBase?`under ${this.assetBase.href}`:`next to the bundle`;if(!a){let e=``;try{e=r?``:Xt(this.assetBase)}catch{}this.reportAsset({code:`asset-load-failed`,severity:`error`,message:`the BPMN icon font did not load ${e?`from ${e}`:o}, so palette and marker icons are missing. Set assetBase, or allow it in font-src.`})}if(r)return;let s=``;try{s=Zt(`inline-01.svg`,this.assetBase)}catch{}let c=s!==``&&await _n(t,s,8e3);this.destroyed||c||this.reportAsset({code:`asset-load-failed`,severity:`error`,message:`the images did not load ${s?`from ${s}`:o}, so palette icons are missing. Set assetBase, or allow it in img-src.`})}assertLive(e){if(this.destroyed||e!==this.epoch)throw X()}enqueue(e,t){let n=this.queue.then(()=>(this.assertLive(e),t()));return this.queue=n.then(()=>void 0,()=>void 0),n.catch(()=>void 0),n}tokensFor(e){return this.tokens}async init(){try{let[e,t,n]=await Promise.all([kt(),At(this.profileId,this.tokensFor(this.profileId)),this.layoutModules()]);if(this.destroyed)return;this.createModeler(e,t,n),this.setupResizeObserver()}catch(e){if(this.destroyed)return;let t={code:`import-failed`,severity:`error`,message:`Engine failed to load: ${String(e?.message??e)}`};this.diagnostics=[t],this.setState(`error`),this.emit(t)}}createModeler(e,t,n){let r=this.options.zoomLimits,i=new e.Modeler({container:this.root,additionalModules:[zt,Rt,...t.modelerModules,...n],bpmnCanvas:jt(this.instanceId,t,this.options.paletteColumns),...r?{zoomScroll:{...r.min===void 0?{}:{minZoom:r.min},...r.max===void 0?{}:{maxZoom:r.max}}}:{}});this.modeler=i;let a=i.get(`eventBus`);return a.on(`commandStack.changed`,e=>this.onStackChanged(e.trigger)),a.on(`element.click`,e=>this.onElementClick(e)),a.on(`root.set`,e=>this.onRootSet(e.element)),a.on(`keyboard.keydown`,2e3,e=>{let t=e.keyEvent;if(!t)return;let n=i.get(`commandStack`);if(gt(t)&&!n.canUndo()&&this.history.past.length>0)return this.undo(),!0;if(_t(t)&&!n.canRedo()&&this.history.future.length>0)return this.redo(),!0}),this.setupDrilldown(i),this.setupWheel(i),this.applyReadOnly(),i}async layoutModules(){try{return[(await e(()=>import(`./layout-q0TR9-aY.js`),[])).BpmnCanvasLayoutModule]}catch{return[]}}removeWheel(){this.wheelListener&&this.root.removeEventListener(`wheel`,this.wheelListener,{capture:this.wheelCapture}),this.wheelListener=void 0}setupWheel(e){this.removeWheel();let t=this.options.wheel??`zoom`;if(t===`zoom`)return;let n=e.get(`zoomScroll`);if(t===`page-scroll`){if(!n)return;n.toggle(!1),this.wheelListener=e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();let t=this.root.getBoundingClientRect();n.stepZoom(e.deltaY<0?1:-1,{x:e.clientX-t.left,y:e.clientY-t.top})},this.wheelCapture=!1,this.root.addEventListener(`wheel`,this.wheelListener,{passive:!1})}else this.wheelListener=e=>{if(e.ctrlKey||e.metaKey||e.deltaY===0)return;e.preventDefault(),e.stopPropagation();let t=this.root.getBoundingClientRect();this.zoomBy(e.deltaY<0?cn:ln,{x:e.clientX-t.left,y:e.clientY-t.top})},this.wheelCapture=!0,this.root.addEventListener(`wheel`,this.wheelListener,{passive:!1,capture:!0})}setupResizeObserver(){typeof ResizeObserver<`u`&&(this.resizeObserver=new ResizeObserver(([e])=>{let t=e?.contentRect;if(this.destroyed||!t||t.width===0||t.height===0)return;let n=`${Math.round(t.width)}x${Math.round(t.height)}`;n!==this.lastSize&&(this.lastSize=n,this.modeler&&this.diagrams.length!==0&&(this.modeler.get(`canvas`).resized(),(!this.fittedOnce||this.fitMode===`whole`)&&this.applyFit(this.fitMode)))}),this.resizeObserver.observe(this.root))}removeDrilldown(){this.drilldownListener&&this.root.removeEventListener(`click`,this.drilldownListener,{capture:!0}),this.drilldownListener=void 0}setupDrilldown(e){this.removeDrilldown(),(this.options.drilldown??`native`)===`event`&&(this.drilldownListener=t=>{let n=t.target?.closest?.(`.bjs-drilldown`);if(!n)return;t.preventDefault(),t.stopPropagation();let r=n.closest(`[data-container-id]`)?.getAttribute(`data-container-id`),i=r?e.get(`elementRegistry`).get(r):void 0;i&&this.onElementClick({element:i,originalEvent:t})},this.root.addEventListener(`click`,this.drilldownListener,{capture:!0}))}onRootSet(e){if(this.destroyed||this.loading>0||!this.modeler)return;let t=e?.businessObject?.id,n=[...this.planeIds].find(([,e])=>e===t)?.[0];n&&n!==this.activeId&&(this.activeId=n,this.resetHistory(),this.options.onChange?.({revision:this.lastRevision??`${this.instanceId}:${this.revisionCounter}`,baseRevision:this.baseRevision,cause:`diagram-switch`,diagramId:n}))}onElementClick(e){let t=e.element,n=t?.businessObject;if(!t||!n||!t.parent||!this.options.onElementClick)return;let r=e.originalEvent?.target,i=typeof n.calledElement==`string`&&n.calledElement?n.calledElement:void 0;this.options.onElementClick({id:t.id,type:t.type,name:typeof n.name==`string`?n.name:``,...i===void 0?{}:{calledElement:i},marker:!!r?.closest?.(on)})}emitHistory(){if(this.destroyed||this.capturing||!this.options.onHistoryChange)return;let e={canUndo:this.canUndo(),canRedo:this.canRedo()},t=`${e.canUndo}${e.canRedo}`;t!==this.lastHistory&&(this.lastHistory=t,this.options.onHistoryChange(e))}onStackChanged(e){if(this.destroyed||this.capturing||(this.loading===0&&e===`execute`&&(this.history.future=[]),this.emitHistory(),this.loading>0||e===`clear`||!this.activeId))return;this.touched=!0;let t=this.inLayout?`layout`:e===`undo`?`undo`:e===`redo`?`redo`:`edit`;this.lastRevision=`${this.instanceId}:${++this.revisionCounter}`,this.options.onChange?.({revision:this.lastRevision,baseRevision:this.baseRevision,cause:t,diagramId:this.activeId})}isEffectivelyReadOnly(){return this.hostReadOnly||this.lossyGate}applyReadOnly(){let e=this.isEffectivelyReadOnly();this.root.classList.toggle(`bpmn-canvas--readonly`,e),this.modeler?.get(`bpmnCanvasReadOnly`)?.setReadOnly(e)}async applyXml(e,t,n){let r=this.modeler;if(!r)return{applied:!1,reason:`invalid`};this.loading++;try{let i=[];bt(e)&&i.push({code:`comments-present`,severity:`warning`,destructive:!0,message:`XML comments are dropped on save.`});let a;try{let t=await r.get(`moddle`).fromXML(e);a=t.rootElement,i.push(...xt(t.warnings),...Tt(a))}catch(t){return this.reject(n,e,[{code:`invalid-xml`,severity:`error`,message:String(t?.message??t).split(`
`)[0]??`invalid XML`}])}if(this.assertLive(n),(a.diagrams??[]).length===0)return this.reject(n,e,i);let o=this.activeId,s=o!==void 0&&(a.diagrams??[]).some(e=>e.id===o)?o:void 0;try{await r.importXML(e,s)}catch(t){return this.assertLive(n),this.setState(`error`),this.reject(n,e,[...i,{code:`import-failed`,severity:`error`,message:String(t?.message??t).split(`
`)[0]??`import failed`}])}this.assertLive(n),this.inputXml=e,this.touched=!1,this.baseRevision=t,this.lastRevision=void 0,this.diagnostics=i;let c=(a.diagrams??[]).filter(e=>typeof e.id==`string`&&e.id!==``);this.diagrams=c.map(e=>({id:e.id,name:Pt(e)})),this.planeIds=new Map(c.map(e=>[e.id,e.plane.bpmnElement?.id??``])),this.activeId=s??this.diagrams[0]?.id,this.history={past:[],future:[]},this.lossyGate=Dt(i)&&this.options.allowLossyEdit!==!0,this.applyReadOnly(),this.fittedOnce=!1,this.initialFit(),this.setState(`ready`),this.emitHistory();for(let e of i)this.emit(e);return this.scheduleAssetCheck(),this.lossyGate&&this.emit({code:`read-only-lossy`,severity:`warning`,message:`The document would lose content on save, so it is open read-only. Set allowLossyEdit to edit anyway.`}),{applied:!0}}finally{this.loading--}}reject(e,t,n){this.assertLive(e),this.diagrams.length===0&&(this.inputXml=t,this.diagnostics=n,this.setState(`error`));for(let e of n)this.emit(e);return{applied:!1,reason:`invalid`}}setXml(e,t={}){if(this.destroyed)return Promise.reject(X());let n=t.revision;if(n!==void 0&&(n===this.baseRevision||n===this.lastRevision))return Promise.resolve({applied:!1,reason:`echo`});let r=++this.epoch;return this.enqueue(r,()=>this.applyXml(e,n,r))}async getXml(){let e=this.epoch;await this.queue,this.assertLive(e);let t=this.modeler;if(!t||this.diagrams.length===0)return this.inputXml;let n=t.get(`directEditing`);if(n?.isActive()&&n.complete(),!this.touched)return this.inputXml;let r;try{r=await this.saveLive(t,e)}catch(t){this.assertLive(e);let n={code:`save-failed`,severity:`error`,message:String(t?.message??t)};throw this.emit(n),t}return this.assertLive(e),r}getDiagrams(){return this.diagrams}getActiveDiagramId(){return this.activeId}selectDiagram(e){if(this.destroyed)return Promise.reject(X());let t=this.epoch,n=++this.navSeq;return this.enqueue(t,async()=>{if(n!==this.navSeq)throw X();let r=this.modeler;if(!r||!this.diagrams.some(t=>t.id===e)){let t=Error(`Unknown diagram id "${e}"`);throw t.name=`UnknownDiagramError`,t}if(e===this.activeId)return;let i=r.get(`directEditing`);i?.isActive()&&i.complete(),this.loading++;try{await r.open(e)}finally{this.loading--}if(this.assertLive(t),n!==this.navSeq)throw X();this.activeId=e,this.history={past:[],future:[]},this.applyFit(this.fitMode),this.emitHistory(),this.options.onChange?.({revision:this.lastRevision??`${this.instanceId}:${this.revisionCounter}`,baseRevision:this.baseRevision,cause:`diagram-switch`,diagramId:e})})}getDiagnostics(){return[...this.watermarkRefusal?[this.watermarkRefusal]:[],...this.assetProblems,...this.diagnostics]}setReadOnly(e){this.destroyed||(this.hostReadOnly=e,this.applyReadOnly())}isReadOnly(){return this.isEffectivelyReadOnly()}getReadOnlyReason(){return this.hostReadOnly?`host`:this.lossyGate?`lossy`:void 0}initialFit(){let e=this.root.getBoundingClientRect();e.width>0&&e.height>0&&this.applyFit(this.fitMode)}applyFit(e,t){let n=this.modeler;if(this.destroyed||!n||this.diagrams.length===0)return;let r=n.get(`canvas`);try{let i=[];for(let e of n.get(`elementRegistry`).getAll())if(e.type!==`bpmn:Process`&&e.type!==`bpmn:Collaboration`){if(typeof e.x==`number`&&typeof e.y==`number`&&typeof e.width==`number`&&typeof e.height==`number`)i.push({x:e.x,y:e.y,width:e.width,height:e.height,type:e.type});else if(Array.isArray(e.waypoints))for(let t of e.waypoints)i.push({x:t.x,y:t.y,width:1,height:1,type:e.type})}let a=this.root.querySelector(`.djs-palette`)?.getBoundingClientRect(),o=this.root.getBoundingClientRect().left,s=a&&a.width>0?a.right-o+8:0,c=an(i,r.getSize(),t??Math.max(s,sn[this.profileId]),e===`whole`);c?r.viewbox(c.viewbox):r.zoom(`fit-viewport`,`auto`),this.fittedOnce=!0}catch{}}fit(e={}){this.applyFit(e.mode??`whole`,e.inset)}setFitMode(e){if(this.destroyed||(this.fitMode=e,!this.modeler||this.diagrams.length===0))return;let t=this.root.ownerDocument.defaultView,n=()=>{!this.destroyed&&this.modeler&&(this.modeler.get(`canvas`).resized(),this.applyFit(e))};t?.requestAnimationFrame?t.requestAnimationFrame(n):n()}zoomLimits(){return{min:this.options.zoomLimits?.min??un,max:this.options.zoomLimits?.max??dn}}getZoom(){let e=this.modeler&&this.diagrams.length>0?this.modeler.get(`canvas`).zoom():1;return typeof e==`number`?e:1}zoomTo(e,t=`auto`){if(this.destroyed||!this.modeler||this.diagrams.length===0)return;let{min:n,max:r}=this.zoomLimits();this.modeler.get(`canvas`).zoom(Math.min(r,Math.max(n,e)),t)}zoomBy(e,t=`auto`){this.zoomTo(this.getZoom()*e,t)}setProfile(e,t){if(this.destroyed)return Promise.reject(X());let n=this.epoch;return this.enqueue(n,async()=>{let r;try{r=await this.prepareSwitch(n,e,t)}catch(e){throw this.assertLive(n),e}this.assertLive(n);let{engine:i,next:a,layout:o,old:s,hadDocument:c,xml:l,view:u,captured:d}=r;c&&(this.history={past:[...d.past,...this.history.past],future:d.future.length>0?d.future:this.history.future},this.capHistory()),this.loading++;try{this.removeWheel(),this.removeDrilldown(),s?.destroy(),this.modeler=void 0,this.profileId=e,this.tokens=t;let n=this.createModeler(i,a,o);if(c){if(await n.importXML(l,this.activeId),this.destroyed)throw X();u&&n.get(`canvas`).viewbox({x:u.x,y:u.y,width:u.width,height:u.height})}}catch(e){throw this.destroyed||e?.name===`AbortError`?X():(this.setState(`error`),this.emit({code:`import-failed`,severity:`error`,message:`Profile switch failed: ${String(e?.message??e)}`}),e)}finally{this.loading--}if(this.destroyed)throw X();c&&this.activeId&&(this.inputXml=l,this.touched=!1,this.emitHistory(),this.options.onChange?.({revision:this.lastRevision??`${this.instanceId}:${this.revisionCounter}`,baseRevision:this.baseRevision,cause:`profile-switch`,diagramId:this.activeId}))})}async prepareSwitch(e,t,n){let[r,i,a]=await Promise.all([kt(),At(t,n),this.layoutModules()]);this.assertLive(e);let o=this.modeler,s=!!o&&this.diagrams.length>0,c=this.inputXml,l,u={past:[],future:[]};if(o&&s){let t=o.get(`directEditing`);t?.isActive()&&t.complete(),this.touched&&(c=await this.saveLive(o,e)),this.assertLive(e),l=o.get(`canvas`).viewbox(),u=await this.captureHistory(o,e),this.assertLive(e)}return{engine:r,next:i,layout:a,old:o,hadDocument:s,xml:c,view:l,captured:u}}stack(){return this.modeler?.get(`commandStack`)}canUndo(){return(this.stack()?.canUndo()??!1)||this.history.past.length>0}canRedo(){return(this.stack()?.canRedo()??!1)||this.history.future.length>0}undo(){if(this.destroyed)return;let e=this.stack();e?.canUndo()?e.undo():this.history.past.length>0&&!this.isEffectivelyReadOnly()&&this.moveHistory(`undo`).catch(()=>void 0)}redo(){if(this.destroyed)return;let e=this.stack();e?.canRedo()?e.redo():this.history.future.length>0&&!this.isEffectivelyReadOnly()&&this.moveHistory(`redo`).catch(()=>void 0)}resetHistory(){(this.history.past.length!==0||this.history.future.length!==0)&&(this.history={past:[],future:[]},this.emitHistory())}capHistory(){let{past:e,future:t}=this.history;for(;e.length+t.length>mn;)e.length>=t.length?e.pop():t.pop()}async saveLive(e,t){let n;try{n=(await e.saveXML({format:!0})).xml}catch(e){throw this.assertLive(t),e}return this.assertLive(t),n}async captureHistory(e,t){let n=e.get(`commandStack`);if(!n.canUndo()&&!n.canRedo())return{past:[],future:[]};let r=e.get(`bpmnCanvasReadOnly`),i=r?.isReadOnly()??!1,a=()=>this.saveLive(e,t);this.capturing=!0,this.loading++,r?.setReadOnly(!1);let o=0;try{let e=[];for(;n.canUndo()&&e.length<mn;)n.undo(),o--,e.push(await a()),this.assertLive(t);for(;o<0;)n.redo(),o++;let r=[];for(;n.canRedo()&&r.length<mn;)n.redo(),o++,r.push(await a()),this.assertLive(t);for(;o>0;)n.undo(),o--;return{past:e,future:r}}finally{try{for(;!this.destroyed&&o<0;)n.redo(),o++;for(;!this.destroyed&&o>0;)n.undo(),o--}finally{r?.setReadOnly(i),this.loading--,this.capturing=!1}}}moveHistory(e){let t=this.epoch;return this.enqueue(t,async()=>{let n=this.modeler;if(!n||this.diagrams.length===0||this.isEffectivelyReadOnly())return;let r=e===`undo`?this.history.past[0]:this.history.future[0];if(r===void 0)return;let i=await this.saveLive(n,t);this.assertLive(t);let a=await this.captureHistory(n,t);this.assertLive(t);let o=n.get(`canvas`).viewbox();this.loading++;try{try{await n.importXML(r,this.activeId)}catch{this.assertLive(t),await n.importXML(r)}}finally{this.loading--}this.assertLive(t),n.get(`canvas`).viewbox({x:o.x,y:o.y,width:o.width,height:o.height}),e===`undo`?(this.history.past.shift(),this.history.future=[i,...a.future,...this.history.future]):(this.history.future.shift(),this.history.past=[i,...a.past,...this.history.past]),this.capHistory(),this.inputXml=r,this.touched=!1,this.lastRevision=`${this.instanceId}:${++this.revisionCounter}`,this.emitHistory(),this.activeId&&this.options.onChange?.({revision:this.lastRevision,baseRevision:this.baseRevision,cause:e,diagramId:this.activeId})})}autoLayout(){if(this.destroyed)return Promise.reject(X());let e=this.epoch;return this.enqueue(e,async()=>{let t=this.modeler,n=t?.get(`bpmnCanvasLayout`);if(!t||!n||this.diagrams.length===0)return this.emit({code:`layout-unsupported`,severity:`warning`,message:`No document is displayed, so there is nothing to lay out.`}),{changed:0,skipped:[]};if(this.isEffectivelyReadOnly())return this.emit({code:`layout-unsupported`,severity:`warning`,message:`The canvas is read-only.`}),{changed:0,skipped:[]};this.inLayout=!0;try{let t=await n.run(()=>!this.destroyed&&e===this.epoch);return this.assertLive(e),(t.changed===0||t.skipped.length>0)&&this.emit({code:`layout-unsupported`,severity:`warning`,ids:t.skipped,message:t.changed===0?`Nothing could be laid out.`:`${t.skipped.length} element(s) were not placed.`}),t}catch(t){throw this.assertLive(e),t?.name===`AbortError`||this.emit({code:`layout-failed`,severity:`error`,message:String(t?.message??t)}),t}finally{this.inLayout=!1}})}destroy(){if(!this.destroyed){this.destroyed=!0,this.history={past:[],future:[]},this.epoch++,this.navSeq++,this.options.signal&&this.abortListener&&this.options.signal.removeEventListener(`abort`,this.abortListener),this.removeWheel(),this.removeDrilldown(),this.resizeObserver?.disconnect(),this.resizeObserver=void 0;try{this.modeler?.destroy()}finally{this.modeler=void 0,this.root.remove(),this.setState(`destroyed`)}}}};function pn(e,t={}){return new fn(e,t)}var mn=100;function hn(e){return e instanceof Error?e.message:String(e)}function gn(e,t){return e.document.readyState===`complete`?new Promise(t=>e.setTimeout(t,50)):new Promise(n=>{let r=()=>{e.removeEventListener(`load`,r),n()};e.addEventListener(`load`,r),e.setTimeout(r,t)})}function _n(e,t,n){return new Promise(r=>{let i=new e.Image,a=e.setTimeout(()=>r(!1),n);i.onload=()=>{e.clearTimeout(a),r(!0)},i.onerror=()=>{e.clearTimeout(a),r(!1)},i.src=t})}function Z(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function vn(e){return Z(e)&&e.ok===!1}function Q(e,t,n){return n===void 0?{ok:!1,code:e,message:t}:{ok:!1,code:e,message:t,pointer:n}}function $(e,t){return`${e}/${String(t).replace(/~/g,`~0`).replace(/\//g,`~1`)}`}function yn(e,t){if(typeof e==`function`)return Q(`unsupported-extension`,`the F1 tree carries a non-data value (§4.1)`,t)}function bn(e,t,n,r){let i=yn(t,n);if(i!==void 0)return{refused:i};if(!Z(t))return{refused:Q(`missing-$type`,`the F1 tree node at ${n||`/`} is not an object`,n)};let a=t.$type;if(typeof a!=`string`||a.length===0)return{refused:Q(`missing-$type`,`the F1 tree node at ${n||`/`} has no $type`,$(n,`$type`))};let o={};for(let[i,a]of Object.entries(t)){if(i===`$type`)continue;let t=$(n,i),s=yn(a,t);if(s!==void 0)return{refused:s};if(Array.isArray(a)){let n=[];for(let i=0;i<a.length;i+=1){let o=$(t,i);if(Z(a[i])){let t=bn(e,a[i],o,r);if(`refused`in t)return t;n.push(t.root)}else{let e=yn(a[i],o);if(e!==void 0)return{refused:e};n.push(a[i])}}o[i]=n}else if(Z(a)){let n=bn(e,a,t,r);if(`refused`in n)return n;o[i]=n.root}else o[i]=a}let s;try{s=e.create(a,o)}catch(e){return{refused:Q(`unknown-type`,e instanceof Error?e.message:String(e),$(n,`$type`))}}return typeof t.id==`string`&&r.set(t.id,s),{root:s}}function xn(e,t,n,r){for(let e of t.$descriptor.properties){if(!e.isReference)continue;let i=$(r,e.name),a=t[e.name],o=(e,t)=>{if(typeof e!=`string`)return e;let r=n.get(e);return r===void 0?Q(`unresolved-reference`,`the reference "${e}" names no element of the document`,t):r};if(e.isMany){if(Array.isArray(a)){let n=[];for(let e=0;e<a.length;e+=1){let t=o(a[e],$(i,e));if(vn(t))return t;n.push(t)}t[e.name]=n}}else if(a!==void 0){let n=o(a,i);if(vn(n))return n;t[e.name]=n}}for(let[i,a]of Object.entries(e)){if(i===`$type`)continue;let e=t[i],o=a,s=$(r,i);if(Array.isArray(o)&&Array.isArray(e)){for(let t=0;t<o.length;t+=1)if(Z(o[t])&&o[t].$type!==void 0){let r=xn(o[t],e[t],n,$(s,t));if(r!==void 0)return r}}else if(Z(o)&&o.$type!==void 0){let t=xn(o,e,n,s);if(t!==void 0)return t}}}function Sn(e){if(!Z(e))return Q(`missing-$type`,`the F1 document is not a JSON object`);let t=new rt,n=new Map,r=bn(t,e,``,n);if(`refused`in r)return r.refused;let i=xn(e,r.root,n,``);return i===void 0?{ok:!0,xml:``,warnings:[]}:i}async function Cn(e){if(!Z(e))return Q(`missing-$type`,`the F1 document is not a JSON object`);let t=new rt,n=new Map,r=bn(t,e,``,n);if(`refused`in r)return r.refused;let i=xn(e,r.root,n,``);if(i!==void 0)return i;try{let{xml:e}=await t.toXML(r.root,{format:!0});return{ok:!0,xml:e,warnings:[]}}catch(e){return Q(`unsupported-extension`,`the F1 tree cannot be serialized: ${e instanceof Error?e.message:String(e)}`)}}function wn(e){return{source:`bpmn-canvas`,validate(t){let n=e(t);return n.ok?(n.warnings??[]).map(e=>({code:e.code,message:e.message,...e.pointer===void 0?{}:{pointer:e.pointer},severity:`warning`})):[{code:n.code,message:n.message,...n.pointer===void 0?{}:{pointer:n.pointer},severity:`error`}]}}}var Tn=m({port:()=>En,renderBpmn:()=>kn,toXml:()=>Dn}),En=wn(e=>Sn(e)),Dn=Cn;function On(e){return{code:e.code,path:``,message:e.message,severity:e.severity===`error`?`error`:`warning`,source:`bpmn-canvas`,...e.ids===void 0?{}:{detail:{ids:e.ids}}}}async function kn(e,t,n){let r=new AbortController,i=pn(e,{xml:t.xml,readOnly:!0,styles:`auto`,signal:r.signal,...t.assetBase===void 0?{}:{assetBase:t.assetBase},...t.watermark===void 0?{}:{watermark:t.watermark},onDiagnostic:e=>n(On(e))});await i.ready;for(let e of i.getDiagnostics())n(On(e));return()=>{r.abort(),i.destroy()}}export{lt as a,ft as c,q as d,pt as f,rt as g,gt as h,ct as i,ht as l,dt as m,it as n,ut as o,_t as p,En as port,at as r,kn as renderBpmn,K as s,Tn as t,Dn as toXml,mt as u};