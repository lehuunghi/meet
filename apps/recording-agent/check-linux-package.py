import argparse,posixpath,tarfile

def validate(filename):
    links=0
    with tarfile.open(filename) as archive:
        for item in archive:
            name=item.name
            if name.startswith('/') or '..' in name.split('/') or name.split('/')[0]!='meet-recorder-linux-x64':raise ValueError('Invalid archive path: '+name)
            if not (item.isfile() or item.isdir() or item.issym() or item.islnk()):raise ValueError('Invalid archive entry type: '+name)
            if item.issym() or item.islnk():
                links+=1
                target=posixpath.normpath(posixpath.join(posixpath.dirname(name) if item.issym() else '',item.linkname))
                if target.startswith('/') or not target.startswith('meet-recorder-linux-x64/'):raise ValueError('Non-portable archive link: '+name+' -> '+item.linkname)
    print('ARCHIVE_LINKS_OK',links)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive');validate(parser.parse_args().archive)
