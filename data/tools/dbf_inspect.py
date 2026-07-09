"""순수 파이썬 DBF 인스펙터 — 필드 구조·표본·코드값 추출 (라이브러리 불필요)"""
import struct, sys, collections

def read_dbf(path, encodings=('utf-8','cp949','euc-kr')):
    f=open(path,'rb'); hdr=f.read(32)
    n_rec, hdr_len, rec_len = struct.unpack('<I',hdr[4:8])[0], struct.unpack('<H',hdr[8:10])[0], struct.unpack('<H',hdr[10:12])[0]
    fields=[]
    while True:
        fd=f.read(32)
        if fd[0:1]==b'\r': break
        name=fd[:11].split(b'\x00')[0].decode('ascii',errors='replace')
        ftype=fd[11:12].decode(); flen=fd[16]; fdec=fd[17]
        fields.append((name,ftype,flen,fdec))
    f.seek(hdr_len)
    def dec(b):
        for e in encodings:
            try: return b.decode(e).strip()
            except: pass
        return b.decode('utf-8',errors='replace').strip()
    def rows(limit=None):
        f.seek(hdr_len); cnt=0
        while True:
            r=f.read(rec_len)
            if len(r)<rec_len or r[0:1]==b'\x1a': break
            if r[0:1]==b'*': continue  # deleted
            pos=1; rec={}
            for name,ftype,flen,_ in fields:
                rec[name]=dec(r[pos:pos+flen]); pos+=flen
            yield rec; cnt+=1
            if limit and cnt>=limit: break
    return n_rec, fields, rows

if __name__=='__main__':
    path=sys.argv[1]; enc=(sys.argv[2],) if len(sys.argv)>2 else ('utf-8','cp949')
    n,fields,rows=read_dbf(path,enc)
    print(f"레코드 수: {n:,}")
    print(f"{'필드':<14}{'타입':<5}{'길이':<5}")
    for name,t,l,d in fields: print(f"{name:<14}{t:<5}{l:<5}")
    print("\n── 표본 3건 ──")
    for i,r in enumerate(rows(3)):
        print(f"[{i+1}]", {k:v for k,v in r.items()})
